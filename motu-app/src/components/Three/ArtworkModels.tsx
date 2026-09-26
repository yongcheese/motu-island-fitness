/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import * as THREE from 'three';
import type { ArtMotif, ArtPalette, ArtworkSpec } from '../../constants/artwork';
import { WIND_ROTORS } from '../../constants/outdoorAnimation';
import { useWindRotor } from './outdoorAnimation';

/**
 * The 3D side of the artwork catalog: one component per {@link ArtworkSpec.form}, filled in from
 * that spec's palette, motif and variant.
 *
 * WHY PARAMETRIC AND NOT FORTY MODELS. FurnitureItem.tsx pairs each item with a hand-built
 * component through a name-keyed registry, which is right for a catalog of forty *different
 * objects* — a toilet and a palm tree share nothing. It is the wrong shape for artwork, where a
 * dozen paintings differ by four colours and what is painted on them. Written that way, adding a
 * picture would mean copying seventy lines of frame geometry and changing three hex codes, and the
 * twelfth copy would be the one where somebody forgets that the canvas has to sit *behind* the
 * moulding rather than flush with it.
 *
 * So the frame is written once and the picture is data. A new painting is one catalog row.
 *
 * ## Two rules everything here obeys
 *
 * **The wall forms are authored centred on their own origin, facing +Z.** Local x and y are the
 * picture's width and height about the centre; local +Z points out of the wall into the room. That
 * is what lets lib/interiorPlacement.ts hang any of them without knowing which one it has: it turns
 * local +Z onto the wall's normal and pushes the piece out by its own measured half-depth, so a
 * thick oil frame and a flat poster both end up exactly against the wall. The tabletop and floor
 * forms follow the codebase's existing invariant instead — local y = 0 is the surface they stand on.
 *
 * **No two faces are coplanar.** Every layer of a picture is stepped by {@link MOTIF_STEP} and the
 * canvas is tucked *inside* its moulding rather than butted against it, because two depth-writing
 * faces in one plane are the single overlap no depth precision can order (`npm run audit:zfighting`
 * exists to catch exactly this). Overlapping solids are fine; coincident faces are not.
 *
 * Nothing here is invisible, additively blended or depth-write-disabled, so every piece of it counts
 * toward the measured footprint — which is deliberate. An artwork's collision box should be the
 * artwork, and the way to guarantee that is to draw no geometry that is not the artwork. That is the
 * "the model is small but the collider is huge" failure, prevented at the source rather than patched.
 */

export interface ArtworkModelProps {
  spec: ArtworkSpec;
  scale?: number;
  /**
   * Placement instance id, when this piece was drawn as a placed object.
   *
   * Only the moving pieces read it (the 風動雕塑's rotor), and only to seed their own phase — so
   * two mobiles standing side by side do not turn as one object. Threaded through
   * {@link renderForm} rather than looked up, for the same reason FurnitureItem threads it: a
   * model has no other way to know which of several copies of itself it is.
   */
  instanceId?: string;
}

// --- Flat picture primitives -------------------------------------------------------------------

/** Thickness of a painted shape. Thin enough to read as paint, thick enough to be a real solid. */
const MOTIF_THICK = 0.008;

/** Gap between successive painted layers. Above the depth buffer's reach at any camera distance. */
const MOTIF_STEP = 0.005;

/** Depth of the canvas/panel a picture is painted on, when a form does not say otherwise. */
const PANEL_DEPTH = 0.035;

/**
 * Where the first painted layer sits on a panel of `depth`: just clear of its front face.
 *
 * Derived from the panel rather than being one constant, because the forms do not share a
 * thickness — a poster is a 14mm sheet and a gallery-wrap canvas is 90mm. A fixed offset sized for
 * the default would leave the poster's motif floating three centimetres in front of the paper.
 */
const motifZ0 = (depth: number) => depth / 2 + MOTIF_STEP;

/** The default panel's first paint layer, for the forms that add detail on top of one. */
const MOTIF_Z0 = motifZ0(PANEL_DEPTH);

/** How far a canvas is tucked in behind its moulding, so no two side faces end up in one plane. */
const CANVAS_TUCK = 0.02;

function Rect({ w, h, x = 0, y = 0, z, color, spin = 0 }: {
  w: number; h: number; x?: number; y?: number; z: number; color: string; spin?: number;
}) {
  return (
    <mesh position={[x, y, z]} rotation={[0, 0, spin]}>
      <boxGeometry args={[w, h, MOTIF_THICK]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

function Disc({ r, x = 0, y = 0, z, color }: {
  r: number; x?: number; y?: number; z: number; color: string;
}) {
  return (
    <mesh position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[r, r, MOTIF_THICK, 24]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

/**
 * A flat triangle facing the viewer.
 *
 * `rotation={[PI/2, spin, 0]}` and not the other way round: three.js applies XYZ euler order as
 * RX·RY·RZ, so the Y term turns the plate about its own axis *before* the X term lays it into the
 * picture plane. Spinning it with the Z term instead would turn it after it is flat, which is the
 * same thing for a disc and very much not for a triangle.
 */
function Tri({ r, x = 0, y = 0, z, color, spin = 0 }: {
  r: number; x?: number; y?: number; z: number; color: string; spin?: number;
}) {
  return (
    <mesh position={[x, y, z]} rotation={[Math.PI / 2, spin, 0]}>
      <cylinderGeometry args={[0, r, MOTIF_THICK, 3]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

/**
 * What is painted on a picture of `w` x `h`.
 *
 * Every motif is three to five flat shapes laid over the ground colour, sized in fractions of the
 * canvas so the same motif works on a 1-unit poster and a 2-unit oil. They are stepped forward in
 * MOTIF_STEP increments in the order they are drawn, which is also their painting order.
 */
function Motif({ motif, palette, w, h, depth = PANEL_DEPTH }: {
  motif: ArtMotif; palette: ArtPalette; w: number; h: number; depth?: number;
}) {
  const a = palette.a ?? '#e07a5f';
  const b = palette.b ?? '#3d5a80';
  const c = palette.c ?? '#f2cc8f';
  const z = (i: number) => motifZ0(depth) + i * MOTIF_STEP;

  switch (motif) {
    case 'island':
      return (
        <>
          <Rect w={w} h={h * 0.3} y={-h * 0.35} z={z(0)} color={b} />
          <Disc r={h * 0.15} x={w * 0.26} y={h * 0.24} z={z(1)} color={c} />
          <Tri r={h * 0.3} x={-w * 0.08} y={-h * 0.1} z={z(2)} color={a} />
          <Tri r={h * 0.2} x={w * 0.1} y={-h * 0.15} z={z(3)} color={b} />
        </>
      );

    case 'ocean':
      return (
        <>
          <Rect w={w} h={h * 0.22} y={h * 0.28} z={z(0)} color={a} />
          <Rect w={w} h={h * 0.24} y={h * 0.02} z={z(1)} color={b} />
          <Rect w={w} h={h * 0.26} y={-h * 0.26} z={z(2)} color={a} />
          <Rect w={w * 0.5} h={h * 0.04} x={-w * 0.16} y={h * 0.34} z={z(3)} color={c} />
        </>
      );

    case 'plant':
      return (
        <>
          <Rect w={w * 0.3} h={h * 0.18} y={-h * 0.34} z={z(0)} color={c} />
          <Rect w={w * 0.035} h={h * 0.5} y={-h * 0.02} z={z(1)} color={b} />
          <Disc r={h * 0.15} x={-w * 0.14} y={h * 0.16} z={z(2)} color={a} />
          <Disc r={h * 0.12} x={w * 0.13} y={h * 0.05} z={z(3)} color={b} />
          <Disc r={h * 0.1} x={-w * 0.05} y={h * 0.32} z={z(4)} color={a} />
        </>
      );

    case 'abstract':
      return (
        <>
          <Rect w={w * 0.42} h={h * 0.55} x={-w * 0.16} y={h * 0.05} z={z(0)} color={a} />
          <Disc r={h * 0.24} x={w * 0.16} y={-h * 0.06} z={z(1)} color={b} />
          <Rect w={w * 0.6} h={h * 0.06} y={-h * 0.32} z={z(2)} color={c} />
        </>
      );

    case 'animal':
      return (
        <>
          <Rect w={w} h={h * 0.34} y={h * 0.3} z={z(0)} color={b} />
          <Disc r={h * 0.26} x={-w * 0.04} y={-h * 0.08} z={z(1)} color={a} />
          <Tri r={h * 0.18} x={w * 0.28} y={-h * 0.02} z={z(2)} color={a} spin={Math.PI} />
          <Disc r={h * 0.035} x={-w * 0.2} y={h * 0.36} z={z(3)} color={c} />
          <Disc r={h * 0.025} x={w * 0.06} y={h * 0.42} z={z(4)} color={c} />
        </>
      );

    case 'portrait':
      return (
        <>
          <Rect w={w * 0.8} h={h * 0.34} y={-h * 0.31} z={z(0)} color={b} />
          <Disc r={h * 0.2} y={h * 0.06} z={z(1)} color={a} />
          <Rect w={w * 0.3} h={h * 0.2} x={-w * 0.14} y={h * 0.16} z={z(2)} color={c} />
        </>
      );

    case 'landscape':
      return (
        <>
          <Rect w={w} h={h * 0.24} y={-h * 0.36} z={z(0)} color={b} />
          <Tri r={h * 0.42} x={-w * 0.18} y={-h * 0.04} z={z(1)} color={a} />
          <Tri r={h * 0.32} x={w * 0.2} y={-h * 0.12} z={z(2)} color={b} />
          <Disc r={h * 0.12} x={w * 0.28} y={h * 0.3} z={z(3)} color={c} />
        </>
      );

    // A HAND-DRAWN ISLAND MAP, and the only motif in this table that depicts a specific thing.
    //
    // It used to be four abstract plates — a big tilted rectangle, a bar and two small squares —
    // which is a fine "an illustration of something" placeholder and completely unreadable as
    // 「手繪島嶼地圖」. What a treasure map is made of is not detail, it is four SIGNS: water, a
    // coastline, a route, and the cross. Those are what is drawn here, and nothing more, so the
    // piece stays as low-poly and as hand-made as the rest of the shelf.
    //
    // Layers are packed rather than stacked: only five z steps fit between the panel face and a
    // framed piece's moulding (see MOTIF_STEP and FramedModel's depth), so shapes that do not
    // cover each other share one. The two islands are far enough apart that their sand rings and
    // their landmasses never meet, which is what lets each pair sit on one layer.
    case 'illustration': {
      // The two landmasses: a main island and a small one across the water, each drawn as a
      // sand ring with the land inside it — a coastline is the one thing that says "island"
      // rather than "green shape".
      const bigX = -w * 0.14, bigY = -h * 0.06;
      const smallX = w * 0.24, smallY = h * 0.16;
      /** Dashes of the route running from the main island out to the cross. */
      const route: Array<[number, number]> = [[-w * 0.02, h * 0.02], [w * 0.06, h * 0.07], [w * 0.14, h * 0.12]];
      return (
        <>
          {/* The sea the map is drawn on, inset so the parchment shows as a margin. */}
          <Rect w={w * 0.9} h={h * 0.84} z={z(0)} color={b} />
          <Disc r={h * 0.3} x={bigX} y={bigY} z={z(1)} color={palette.ground ?? '#f0e2c0'} />
          <Disc r={h * 0.16} x={smallX} y={smallY} z={z(1)} color={palette.ground ?? '#f0e2c0'} />
          <Disc r={h * 0.24} x={bigX} y={bigY} z={z(2)} color={a} />
          <Disc r={h * 0.115} x={smallX} y={smallY} z={z(2)} color={a} />
          {/* The landmark on the big island, the dashed route, and the first stroke of the cross —
              none of the three touches another, so all three share a layer. */}
          {/* The peak marked on the big island. `spin={PI}` because a `Tri` draws its apex
              downward at rest, and a mountain that points down is a funnel. */}
          <Tri r={h * 0.085} x={bigX} y={bigY + h * 0.04} z={z(3)} color={palette.ground ?? '#f0e2c0'} spin={Math.PI} />
          {route.map(([rx, ry], i) => (
            <Rect key={i} w={w * 0.05} h={h * 0.018} x={rx} y={ry} z={z(3)} color={c} spin={0.5} />
          ))}
          <Rect w={w * 0.09} h={h * 0.028} x={smallX} y={smallY} z={z(3)} color={c} spin={0.78} />
          {/* ...and the second stroke, which crosses the first and therefore needs its own. */}
          <Rect w={w * 0.09} h={h * 0.028} x={smallX} y={smallY} z={z(4)} color={c} spin={-0.78} />
        </>
      );
    }

    case 'still':
      return (
        <>
          <Rect w={w * 0.9} h={h * 0.16} y={-h * 0.32} z={z(0)} color={c} />
          <Disc r={h * 0.22} x={-w * 0.1} y={-h * 0.02} z={z(1)} color={a} />
          <Rect w={w * 0.1} h={h * 0.16} x={-w * 0.1} y={h * 0.22} z={z(2)} color={a} />
          <Disc r={h * 0.09} x={w * 0.18} y={-h * 0.16} z={z(3)} color={b} />
          <Disc r={h * 0.07} x={w * 0.3} y={-h * 0.2} z={z(4)} color={b} />
        </>
      );

    case 'sunset':
    default:
      return (
        <>
          <Disc r={h * 0.26} y={h * 0.04} z={z(0)} color={a} />
          <Rect w={w} h={h * 0.07} y={-h * 0.14} z={z(1)} color={b} />
          <Rect w={w} h={h * 0.07} y={-h * 0.28} z={z(2)} color={b} />
          <Rect w={w} h={h * 0.06} y={-h * 0.4} z={z(3)} color={c} />
        </>
      );
  }
}

/** The painted panel a picture lives on, with its motif already on it. */
function PicturePanel({ w, h, spec, depth = PANEL_DEPTH }: {
  w: number; h: number; spec: ArtworkSpec; depth?: number;
}) {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[w, h, depth]} />
        <meshStandardMaterial color={spec.palette.ground ?? '#f6f1e4'} roughness={0.95} />
      </mesh>
      {spec.motif && <Motif motif={spec.motif} palette={spec.palette} w={w} h={h} depth={depth} />}
    </group>
  );
}

/**
 * Four bars of moulding around a picture of `w` x `h`.
 *
 * The bars sit at the same z as the canvas but stand `depth` proud of it, and the canvas is drawn
 * `CANVAS_TUCK` wider than the opening so its own edges finish *inside* the bars. Butting them
 * edge to edge instead would put the canvas's side face and the bar's inner face in one plane —
 * which is the coplanarity this file's header is about.
 */
function Moulding({ w, h, bar, depth, color }: {
  w: number; h: number; bar: number; depth: number; color: string;
}) {
  const outerW = w + bar * 2;
  return (
    <group>
      <mesh position={[0, h / 2 + bar / 2, 0]} castShadow>
        <boxGeometry args={[outerW, bar, depth]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, -h / 2 - bar / 2, 0]} castShadow>
        <boxGeometry args={[outerW, bar, depth]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[-w / 2 - bar / 2, 0, 0]} castShadow>
        <boxGeometry args={[bar, h, depth]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[w / 2 + bar / 2, 0, 0]} castShadow>
        <boxGeometry args={[bar, h, depth]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  );
}

// --- Wall forms --------------------------------------------------------------------------------

function FramedModel({ spec, w, h, bar, depth }: {
  spec: ArtworkSpec; w: number; h: number; bar: number; depth: number;
}) {
  return (
    <group>
      <PicturePanel w={w + CANVAS_TUCK * 2} h={h + CANVAS_TUCK * 2} spec={spec} />
      <Moulding w={w} h={h} bar={bar} depth={depth} color={spec.palette.frame ?? '#6b5745'} />
    </group>
  );
}

/** Gallery wrap: the canvas is the whole piece, with its painted edge turning the corner. */
function CanvasModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  return (
    <group>
      <PicturePanel w={w} h={h} spec={spec} depth={0.09} />
      {/* Stretcher bar peeking round the back, so the piece reads as a real canvas from an angle.
          Narrower than the canvas on every side, so none of its faces meets one of the canvas's. */}
      <mesh position={[0, 0, -0.075]} castShadow>
        <boxGeometry args={[w - 0.1, h - 0.1, 0.06]} />
        <meshStandardMaterial color="#c8b391" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Oil: a deep moulding, an inner gilt fillet, and three dabs of impasto standing off the paint. */
function OilModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const gilt = spec.palette.frame ?? '#b08b4f';
  return (
    <group>
      <PicturePanel w={w + CANVAS_TUCK * 2} h={h + CANVAS_TUCK * 2} spec={spec} />
      <Moulding w={w} h={h} bar={0.13} depth={0.16} color={gilt} />
      {/* Inner fillet: a thinner, shallower band lapping the opening, offset in z from the main
          moulding so the two never share a face. */}
      <Moulding w={w - 0.02} h={h - 0.02} bar={0.05} depth={0.1} color="#e8d9b8" />
      <mesh position={[-w * 0.2, h * 0.12, MOTIF_Z0 + 0.03]} rotation={[0, 0, 0.4]} castShadow>
        <boxGeometry args={[w * 0.2, 0.03, 0.02]} />
        <meshStandardMaterial color={spec.palette.c ?? '#f4a259'} roughness={1} />
      </mesh>
      <mesh position={[w * 0.14, -h * 0.2, MOTIF_Z0 + 0.036]} rotation={[0, 0, -0.3]} castShadow>
        <boxGeometry args={[w * 0.16, 0.026, 0.018]} />
        <meshStandardMaterial color={spec.palette.a ?? '#e76f51'} roughness={1} />
      </mesh>
    </group>
  );
}

/** Poster: a sheet with no frame, held at the corners by four tacks. */
function PosterModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const tack = spec.palette.a ?? '#ef476f';
  return (
    <group>
      <PicturePanel w={w} h={h} spec={spec} depth={0.014} />
      {([[-1, 1], [1, 1], [-1, -1], [1, -1]] as const).map(([sx, sy], i) => (
        <mesh
          key={i}
          position={[sx * (w / 2 - 0.06), sy * (h / 2 - 0.06), 0.02 + i * 0.001]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.022, 0.022, 0.02, 10]} />
          <meshStandardMaterial color={tack} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Tapestry: cloth on a rod, with a fringed hem. */
function TapestryModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const rod = spec.palette.frame ?? '#8d6e52';
  const fringe = spec.palette.b ?? '#cbb89d';
  const clothH = h - 0.22;
  return (
    <group>
      {/* Rod, overhanging the cloth at both ends. */}
      <mesh position={[0, h / 2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, w + 0.28, 12]} />
        <meshStandardMaterial color={rod} roughness={0.8} />
      </mesh>
      {([-1, 1] as const).map((s) => (
        <mesh key={s} position={[s * (w / 2 + 0.16), h / 2, 0]} castShadow>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshStandardMaterial color={rod} roughness={0.6} />
        </mesh>
      ))}
      <group position={[0, h / 2 - 0.09 - clothH / 2, 0]}>
        <PicturePanel w={w} h={clothH} spec={spec} depth={0.022} />
      </group>
      {/* Hem fringe: seven strands of slightly different length, which is what stops a woven piece
          reading as a printed rectangle. */}
      {Array.from({ length: 7 }).map((_, i) => {
        const len = 0.1 + ((i * 37) % 5) * 0.016;
        return (
          <mesh
            key={i}
            position={[(i - 3) * (w / 7), h / 2 - 0.09 - clothH - len / 2, 0.004 * (i % 3)]}
            castShadow
          >
            <boxGeometry args={[0.03, len, 0.016]} />
            <meshStandardMaterial color={fringe} roughness={1} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * One hanging feather: a quill with a vane either side of it, and a point at the bottom.
 *
 * WHY IT IS THREE SHAPES AND NOT ONE PLATE. 「羽毛流蘇掛飾不容易辨識」 — the feather used to be a
 * flat 11cm-wide box with a stripe down it, and a rectangle with a stripe is a rectangle. What
 * makes a feather read is its SILHOUETTE: narrow where it is tied on, widest about a third of the
 * way down, tapering to a point. Two tapered prisms stacked nose to nose draw exactly that in two
 * meshes — `cylinderGeometry`'s two radii are the taper, and flattening z turns the prism into a
 * vane. The quill is the third, standing proud of both so the feather has a spine rather than a
 * painted line, and it carries the palette's darkest tone because contrast down the middle is the
 * other half of what says "feather" at a glance.
 */
function Feather({ len, vaneTop, vaneLow, quill }: {
  len: number; vaneTop: string; vaneLow: string; quill: string;
}) {
  const upperH = len * 0.34;
  const lowerH = len * 0.66;
  // Roughly a third of the plume's length. The first cut of this was a fifth, and at that
  // proportion a tapered prism is a DART: the shape only reads as a feather once it is wide
  // enough that the eye sees a blade with a shaft down it rather than a spike.
  const halfW = 0.1;
  return (
    <group>
      {/* Upper vane: narrow at the tie, opening out. */}
      <mesh position={[0, -upperH / 2, 0]} scale={[1, 1, 0.26]} castShadow>
        <cylinderGeometry args={[0.024, halfW, upperH, 8]} />
        <meshStandardMaterial color={vaneTop} roughness={1} flatShading />
      </mesh>
      {/* Lower vane: widest at the shoulder, closing to a point. Slightly darker, which is what
          gives the plume its own light rather than leaving it one flat tone. */}
      <mesh position={[0, -upperH - lowerH / 2, 0]} scale={[1, 1, 0.26]} castShadow>
        <cylinderGeometry args={[halfW, 0.022, lowerH, 8]} />
        <meshStandardMaterial color={vaneLow} roughness={1} flatShading />
      </mesh>
      {/* THE QUILL, and it is in FRONT of the vane rather than through it.
          The vane is flattened to a quarter of its width in z, so a shaft centred on the plume's
          own axis is buried inside it and invisible from the one direction a wall piece is looked
          at — which is where the first cut of this went: a feather with no spine is a kite. A dark
          line down a pale blade is the single strongest cue the shape has, so it is drawn on the
          face where it can be seen, and mirrored behind so the piece still reads from the side.

          Stopped a hair short of the vane's own top and bottom rather than running the full
          length: flush would put its end faces in the same two planes as the vane's, which is the
          coplanarity `npm run audit:placements` fails on (and which really does shimmer, since
          both are opaque and one covers the other exactly). */}
      {[0.026, -0.026].map((z) => (
        <mesh key={z} position={[0, -len * 0.5, z]} castShadow>
          <boxGeometry args={[0.016, len * 0.92, 0.014]} />
          <meshStandardMaterial color={quill} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** Macramé: a dowel, hanging cords, and either a knotted lattice or cut feathers. */
function MacrameModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const dowel = spec.palette.frame ?? '#a9825c';
  const cord = spec.palette.a ?? '#e4d5bd';
  const knot = spec.palette.b ?? '#cbb89d';
  const accent = spec.palette.c ?? knot;
  const isFeather = spec.variant === 'feather';
  const cords = isFeather ? 5 : 7;

  return (
    <group>
      <mesh position={[0, h / 2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.032, 0.032, w + 0.2, 10]} />
        <meshStandardMaterial color={dowel} roughness={0.85} />
      </mesh>
      {Array.from({ length: cords }).map((_, i) => {
        const x = (i - (cords - 1) / 2) * (w / (isFeather ? cords - 1 : cords));
        // Shorter than the knotted variant's cords on purpose. A feather is a BLADE, and a blade
        // three times longer than it is wide stops reading as one however it is tapered; these
        // land between 1:2.5 and 1:4 against the vane's width, which is about where a real plume
        // sits. The stagger is what keeps five of them from reading as a comb.
        const len = isFeather ? h * (0.3 + ((i * 29) % 4) * 0.055) : h * 0.72;
        if (isFeather) {
          // A hanging cord, the binding that holds the feather to it, then the feather. Splitting
          // the drop into cord + binding + plume is what makes it a HUNG object rather than a
          // shape floating under a stick — and the binding is where the eye reads "hand-made".
          const cordLen = h * 0.14;
          return (
            <group key={i} position={[x, h / 2 - 0.04, 0.004 * (i % 3)]}>
              <mesh position={[0, -cordLen / 2, 0]} castShadow>
                <boxGeometry args={[0.018, cordLen, 0.018]} />
                <meshStandardMaterial color={cord} roughness={1} />
              </mesh>
              <mesh position={[0, -cordLen, 0]} castShadow>
                <boxGeometry args={[0.05, 0.05, 0.04]} />
                <meshStandardMaterial color={accent} roughness={0.9} />
              </mesh>
              <group position={[0, -cordLen - 0.03, 0]}>
                <Feather len={len} vaneTop={cord} vaneLow={knot} quill={accent} />
              </group>
            </group>
          );
        }
        return (
          <group key={i} position={[x, h / 2 - len / 2 - 0.04, 0.003 * (i % 3)]}>
            <mesh castShadow>
              <boxGeometry args={[0.026, len, 0.018]} />
              <meshStandardMaterial color={cord} roughness={1} />
            </mesh>
            {/* Cord knot — the detail that separates the two variants. */}
            <mesh position={[0, -len * 0.16, 0.016]} castShadow>
              <boxGeometry args={[0.05, 0.05, 0.014]} />
              <meshStandardMaterial color={knot} roughness={0.9} />
            </mesh>
          </group>
        );
      })}
      {/* THE TASSEL — the other half of the piece's own name (羽毛＋流蘇), and it was simply not
          drawn before. A bound bundle of cut cord hanging at the centre, shorter than the feathers
          around it so the two read as different things rather than as one fringe. */}
      {isFeather && (
        // IN FRONT of the feathers (+z) and hanging LONGER than any of them, which is the whole
        // reason it is visible at all: the first pass put it behind them at half their length and
        // the piece went back to being five plumes on a stick. A tassel that ends above the thing
        // it hangs beside is not a tassel, it is a fringe nobody can see.
        <group position={[0, h / 2 - 0.04, 0.06]}>
          <mesh position={[0, -h * 0.09, 0]} castShadow>
            <boxGeometry args={[0.075, 0.08, 0.055]} />
            <meshStandardMaterial color={accent} roughness={0.9} />
          </mesh>
          {Array.from({ length: 6 }).map((_, i) => {
            const strand = h * (0.5 + ((i * 17) % 4) * 0.05);
            return (
              <mesh
                key={i}
                position={[(i - 2.5) * 0.021, -h * 0.09 - strand / 2 - 0.03, 0.005 * (i % 2)]}
                rotation={[0, 0, (i - 2.5) * 0.05]}
                castShadow
              >
                <boxGeometry args={[0.017, strand, 0.017]} />
                <meshStandardMaterial color={i % 2 ? cord : knot} roughness={1} />
              </mesh>
            );
          })}
        </group>
      )}
      {/* Knotted lattice, only on the knotted variant: two crossing bands of cord. */}
      {!isFeather && ([0.16, -0.06] as const).map((yf, i) => (
        <mesh key={i} position={[0, h * yf, 0.022]} rotation={[0, 0, i === 0 ? 0.2 : -0.2]} castShadow>
          <boxGeometry args={[w * 0.8, 0.03, 0.014]} />
          <meshStandardMaterial color={knot} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** Relief: a backing board carrying either driftwood staves or a carved wave. */
function ReliefModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const board = spec.palette.frame ?? '#6b5745';
  const wood = spec.palette.ground ?? '#a1866b';
  const light = spec.palette.a ?? '#c9b79c';
  const dark = spec.palette.b ?? '#7d6a55';
  const isDriftwood = spec.variant === 'driftwood';

  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[w, h, 0.05]} />
        <meshStandardMaterial color={board} roughness={0.95} />
      </mesh>
      {isDriftwood
        ? Array.from({ length: 6 }).map((_, i) => {
          const len = h * (0.5 + ((i * 41) % 5) * 0.09);
          return (
            <mesh
              key={i}
              position={[(i - 2.5) * (w / 6.6), (((i * 23) % 3) - 1) * h * 0.06, 0.05 + i * 0.006]}
              rotation={[0, 0, 0.08 * (i % 2 ? 1 : -1)]}
              castShadow
            >
              <cylinderGeometry args={[0.035, 0.045, len, 7]} />
              <meshStandardMaterial color={i % 2 ? wood : light} roughness={1} />
            </mesh>
          );
        })
        : (
          <>
            {/* Carved wave: three chiselled bands, each standing a little further off the board. */}
            {[0.22, 0, -0.22].map((yf, i) => (
              <mesh key={i} position={[0, h * yf, 0.045 + i * 0.012]} rotation={[0, 0, 0.03 * (i - 1)]} castShadow>
                <boxGeometry args={[w * 0.86, h * 0.13, 0.05]} />
                <meshStandardMaterial color={i === 1 ? light : wood} roughness={0.95} />
              </mesh>
            ))}
            <mesh position={[w * 0.3, h * 0.05, 0.09]} rotation={[Math.PI / 2, 0.4, 0]} castShadow>
              <cylinderGeometry args={[0, h * 0.22, 0.04, 3]} />
              <meshStandardMaterial color={dark} roughness={1} />
            </mesh>
          </>
        )}
    </group>
  );
}

/** Gallery: several small framed pictures hung as one composition. */
function GalleryModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const isGrid = spec.variant === 'grid';
  const cols = isGrid ? 3 : 3;
  const rows = isGrid ? 2 : 1;
  const gap = 0.1;
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;

  return (
    <group>
      {Array.from({ length: rows * cols }).map((_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // The grid variant leaves its last cell empty on purpose — see the item's description.
        if (isGrid && i === rows * cols - 1) return null;
        return (
          <group
            key={i}
            position={[
              (col - (cols - 1) / 2) * (cellW + gap),
              ((rows - 1) / 2 - row) * (cellH + gap),
              // Each frame a hair further out than the last, so no two backs land in one plane.
              i * 0.004,
            ]}
          >
            <FramedModel
              spec={spec}
              w={cellW - 0.1}
              h={cellH - 0.1}
              bar={0.05}
              depth={0.06}
            />
          </group>
        );
      })}
    </group>
  );
}

/** Charm: a peg on the wall with a short string of small pieces hanging from it. */
function CharmModel({ spec, w, h }: { spec: ArtworkSpec; w: number; h: number }) {
  const peg = spec.palette.frame ?? '#9c7c5b';
  const cord = spec.palette.ground ?? '#f6ece0';
  const a = spec.palette.a ?? '#f2d6c2';
  const b = spec.palette.b ?? '#cfa98a';
  const isGeometric = spec.variant === 'geometric';

  return (
    <group>
      <mesh position={[0, h / 2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.09, 10]} />
        <meshStandardMaterial color={peg} roughness={0.7} />
      </mesh>
      <mesh position={[0, h * 0.16, 0]} castShadow>
        <boxGeometry args={[0.016, h * 0.62, 0.016]} />
        <meshStandardMaterial color={cord} roughness={1} />
      </mesh>
      {Array.from({ length: 3 }).map((_, i) => {
        const y = h * (0.08 - i * 0.19);
        const size = w * (0.5 - i * 0.06);
        const color = i === 1 ? b : a;
        const z = 0.006 * (i + 1);
        if (isGeometric) {
          // Circle, triangle, square — in that order, which the item's description insists on.
          if (i === 0) return <Disc key={i} r={size * 0.5} y={y} z={z} color={color} />;
          if (i === 1) return <Tri key={i} r={size * 0.55} y={y} z={z} color={color} />;
          return <Rect key={i} w={size * 0.8} h={size * 0.8} y={y} z={z} color={color} />;
        }
        return (
          <mesh key={i} position={[0, y, z]} rotation={[Math.PI / 2, 0, 0.3 * i]} scale={[1, 0.35, 1]} castShadow>
            <sphereGeometry args={[size * 0.42, 10, 8]} />
            <meshStandardMaterial color={color} roughness={0.55} />
          </mesh>
        );
      })}
    </group>
  );
}

// --- Tabletop and floor forms ------------------------------------------------------------------

/** A small creature on a base. `cat` curls; `bird` stands with its beak up. */
function FigurineModel({ spec }: { spec: ArtworkSpec }) {
  const base = spec.palette.frame ?? '#8a6a45';
  const body = spec.palette.ground ?? '#e9dcc5';
  const accent = spec.palette.a ?? '#c98f6a';
  const dark = spec.palette.b ?? '#3d3d3d';
  const isBird = spec.variant === 'bird';

  return (
    <group>
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.17, 0.19, 0.06, 16]} />
        <meshStandardMaterial color={base} roughness={0.85} />
      </mesh>
      {isBird ? (
        <>
          <mesh position={[0, 0.24, 0]} rotation={[0.25, 0, 0]} scale={[1, 1.5, 1]} castShadow>
            <sphereGeometry args={[0.13, 14, 12]} />
            <meshStandardMaterial color={body} roughness={0.75} />
          </mesh>
          <mesh position={[0, 0.42, 0.02]} castShadow>
            <sphereGeometry args={[0.085, 12, 10]} />
            <meshStandardMaterial color={body} roughness={0.75} />
          </mesh>
          <mesh position={[0, 0.44, 0.11]} rotation={[-0.7, 0, 0]} castShadow>
            <coneGeometry args={[0.032, 0.11, 8]} />
            <meshStandardMaterial color={accent} roughness={0.6} />
          </mesh>
          {([-1, 1] as const).map((s) => (
            <mesh key={s} position={[s * 0.11, 0.24, -0.01]} rotation={[0, 0, s * 0.3]} scale={[0.6, 1.7, 1]} castShadow>
              <sphereGeometry args={[0.05, 10, 8]} />
              <meshStandardMaterial color={dark} roughness={0.8} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          <mesh position={[0, 0.17, 0]} scale={[1.2, 0.85, 1]} castShadow>
            <sphereGeometry args={[0.19, 16, 14]} />
            <meshStandardMaterial color={body} roughness={0.6} />
          </mesh>
          <mesh position={[0.02, 0.31, 0.09]} castShadow>
            <sphereGeometry args={[0.12, 14, 12]} />
            <meshStandardMaterial color={body} roughness={0.6} />
          </mesh>
          {([-1, 1] as const).map((s) => (
            <mesh key={s} position={[s * 0.07, 0.41, 0.09]} rotation={[0, 0, s * 0.25]} castShadow>
              <coneGeometry args={[0.045, 0.09, 4]} />
              <meshStandardMaterial color={accent} roughness={0.7} />
            </mesh>
          ))}
          {/* Tail, curled round to the nose — the pose the description promises. */}
          <mesh position={[-0.16, 0.18, 0.11]} rotation={[0, 0, 0.5]} castShadow>
            <torusGeometry args={[0.11, 0.032, 8, 18, Math.PI * 1.2]} />
            <meshStandardMaterial color={accent} roughness={0.7} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** A thrown vessel: foot, belly, shoulder, neck — and two small handles. */
function VesselModel({ spec }: { spec: ArtworkSpec }) {
  const body = spec.palette.ground ?? '#c1734a';
  const shade = spec.palette.a ?? '#8f4f34';
  const rim = spec.palette.b ?? '#e8d5b7';

  return (
    <group>
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.11, 0.07, 18]} />
        <meshStandardMaterial color={shade} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.27, 0]} scale={[1, 1.15, 1]} castShadow>
        <sphereGeometry args={[0.22, 18, 14]} />
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.14, 0.13, 16]} />
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.525, 0]} castShadow>
        <cylinderGeometry args={[0.105, 0.095, 0.035, 16]} />
        <meshStandardMaterial color={rim} roughness={0.8} />
      </mesh>
      {([-1, 1] as const).map((s) => (
        <mesh key={s} position={[s * 0.21, 0.4, 0]} castShadow>
          <torusGeometry args={[0.07, 0.022, 8, 16]} />
          <meshStandardMaterial color={shade} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** A vase, with three stems standing in it. */
function VaseModel({ spec, tall = false }: { spec: ArtworkSpec; tall?: boolean }) {
  const body = spec.palette.ground ?? '#f0e6d2';
  const shade = spec.palette.a ?? '#d9c8ac';
  const stem = spec.palette.b ?? '#6b8f71';
  const bloom = spec.palette.c ?? '#e07a5f';
  const s = tall ? 2.35 : 1;

  return (
    <group>
      <mesh position={[0, 0.02 * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13 * s, 0.15 * s, 0.04 * s, 18]} />
        <meshStandardMaterial color={shade} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.22 * s, 0]} castShadow>
        <cylinderGeometry args={[0.1 * s, 0.16 * s, 0.36 * s, 18]} />
        <meshStandardMaterial color={body} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.42 * s, 0]} castShadow>
        <cylinderGeometry args={[0.075 * s, 0.1 * s, 0.06 * s, 18]} />
        <meshStandardMaterial color={shade} roughness={0.5} />
      </mesh>
      {[-1, 0, 1].map((i) => (
        <group key={i} position={[i * 0.035 * s, 0.45 * s, i * 0.02 * s]} rotation={[i * 0.12, 0, i * 0.16]}>
          <mesh position={[0, 0.16 * s, 0]} castShadow>
            <cylinderGeometry args={[0.012 * s, 0.014 * s, 0.32 * s, 7]} />
            <meshStandardMaterial color={stem} roughness={1} />
          </mesh>
          <mesh position={[0.03 * s, 0.3 * s, 0]} rotation={[0, 0, 0.5]} scale={[0.5, 1.4, 0.5]} castShadow>
            <sphereGeometry args={[0.05 * s, 10, 8]} />
            <meshStandardMaterial color={i === 0 ? bloom : stem} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A small abstract solid: a pierced arch, or a twisted loop on a block. */
function ObjetModel({ spec, big = false }: { spec: ArtworkSpec; big?: boolean }) {
  const base = spec.palette.frame ?? '#b9b0a2';
  const body = spec.palette.ground ?? '#d6cec1';
  const shade = spec.palette.a ?? '#8d867a';
  const s = big ? 2.6 : 1;
  const isLoop = spec.variant === 'loop';

  return (
    <group>
      <mesh position={[0, 0.03 * s, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.34 * s, 0.06 * s, 0.24 * s]} />
        <meshStandardMaterial color={base} roughness={0.9} />
      </mesh>
      {isLoop ? (
        <mesh position={[0, 0.32 * s, 0]} rotation={[0.5, 0.4, 0]} castShadow>
          <torusGeometry args={[0.19 * s, 0.045 * s, 10, 26]} />
          <meshStandardMaterial color={body} roughness={0.35} metalness={0.4} />
        </mesh>
      ) : (
        <>
          {/* The arch: two legs and a lintel, so the hole through the middle is real geometry
              rather than a painted-on suggestion of one. */}
          {([-1, 1] as const).map((sx) => (
            <mesh key={sx} position={[sx * 0.13 * s, 0.24 * s, 0]} castShadow>
              <boxGeometry args={[0.08 * s, 0.36 * s, 0.16 * s]} />
              <meshStandardMaterial color={body} roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[0, 0.45 * s, 0]} castShadow>
            <torusGeometry args={[0.13 * s, 0.04 * s, 8, 18, Math.PI]} />
            <meshStandardMaterial color={shade} roughness={0.9} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** A decorative plate standing in a display easel. */
function PlateModel({ spec }: { spec: ArtworkSpec }) {
  const stand = spec.palette.frame ?? '#8a6a45';
  const face = spec.palette.ground ?? '#f4f1e8';
  const a = spec.palette.a ?? '#2a4b8d';
  const b = spec.palette.b ?? '#5b7fc7';

  return (
    <group>
      <mesh position={[0, 0.02, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.26, 0.04, 0.16]} />
        <meshStandardMaterial color={stand} roughness={0.9} />
      </mesh>
      {/* Back leg, holding the plate at a slight lean. */}
      <mesh position={[0, 0.16, -0.09]} rotation={[0.32, 0, 0]} castShadow>
        <boxGeometry args={[0.05, 0.3, 0.03]} />
        <meshStandardMaterial color={stand} roughness={0.9} />
      </mesh>
      <group position={[0, 0.3, 0.02]} rotation={[Math.PI / 2 - 0.22, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.25, 0.25, 0.03, 28]} />
          <meshStandardMaterial color={face} roughness={0.35} />
        </mesh>
        {/* Rim, then the pattern — each a hair proud of the last. */}
        <mesh position={[0, 0.018, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.235, 0.016, 8, 28]} />
          <meshStandardMaterial color={a} roughness={0.4} />
        </mesh>
        {spec.motif === 'sunset'
          ? Array.from({ length: 8 }).map((_, i) => (
            <mesh key={i} position={[0, 0.024, 0]} rotation={[0, (i * Math.PI) / 4, 0]}>
              <boxGeometry args={[0.02, 0.008, 0.3 - (i % 2) * 0.07]} />
              <meshStandardMaterial color={i % 2 ? a : b} roughness={0.5} />
            </mesh>
          ))
          : (
            <>
              <mesh position={[0, 0.026, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.14, 0.014, 8, 24]} />
                <meshStandardMaterial color={b} roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.03, 0]}>
                <cylinderGeometry args={[0.055, 0.055, 0.012, 20]} />
                <meshStandardMaterial color={a} roughness={0.5} />
              </mesh>
            </>
          )}
      </group>
    </group>
  );
}

/** A mineral: a cluster of points growing out of matrix, or one point on a stand. */
function CrystalModel({ spec }: { spec: ArtworkSpec }) {
  const matrix = spec.palette.frame ?? '#4a3f55';
  const body = spec.palette.ground ?? '#9b7bc4';
  const bright = spec.palette.a ?? '#c9b6e8';
  const deep = spec.palette.b ?? '#6a4f8a';
  const isPoint = spec.variant === 'point';

  return (
    <group>
      <mesh position={[0, 0.11, 0]} scale={[1, 0.55, 1]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.19, 0]} />
        <meshStandardMaterial color={matrix} roughness={1} />
      </mesh>
      {isPoint ? (
        <mesh position={[0, 0.42, 0]} rotation={[0.05, 0.4, 0.03]} castShadow>
          <cylinderGeometry args={[0.075, 0.095, 0.62, 6]} />
          <meshStandardMaterial color={body} roughness={0.15} metalness={0.05} />
        </mesh>
      ) : (
        [0, 1, 2, 3, 4].map((i) => {
          const angle = (i / 5) * Math.PI * 2;
          const len = 0.24 + ((i * 31) % 4) * 0.07;
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * 0.09, 0.16 + len / 2, Math.sin(angle) * 0.09]}
              rotation={[Math.cos(angle) * 0.3, 0, -Math.sin(angle) * 0.3]}
              castShadow
            >
              <cylinderGeometry args={[0.035, 0.055, len, 6]} />
              <meshStandardMaterial color={i % 2 ? body : bright} roughness={0.2} />
            </mesh>
          );
        })
      )}
      {/* Tip, catching the light — one facet brighter than the rest. */}
      <mesh position={[0, isPoint ? 0.76 : 0.44, 0]} castShadow>
        <coneGeometry args={[isPoint ? 0.075 : 0.05, 0.14, 6]} />
        <meshStandardMaterial color={isPoint ? bright : deep} roughness={0.15} />
      </mesh>
    </group>
  );
}

/** Handmade: a woven basket, or a little boat with a cloth sail. */
function CraftModel({ spec }: { spec: ArtworkSpec }) {
  const wood = spec.palette.frame ?? '#7a5c3e';
  const body = spec.palette.ground ?? '#c9a870';
  const a = spec.palette.a ?? '#a3813f';
  const b = spec.palette.b ?? '#e8d8b8';

  if (spec.variant === 'boat') {
    return (
      <group>
        <mesh position={[0, 0.15, 0]} rotation={[Math.PI, 0, 0]} scale={[1, 0.55, 0.5]} castShadow receiveShadow>
          <sphereGeometry args={[0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={body} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.13, 0]} castShadow>
          <boxGeometry args={[0.42, 0.03, 0.13]} />
          <meshStandardMaterial color={wood} roughness={0.9} />
        </mesh>
        <mesh position={[-0.02, 0.34, 0]} castShadow>
          <cylinderGeometry args={[0.014, 0.018, 0.42, 8]} />
          <meshStandardMaterial color={wood} roughness={0.9} />
        </mesh>
        <mesh position={[0.08, 0.34, 0]} rotation={[0, 0, -0.1]} castShadow>
          <boxGeometry args={[0.17, 0.32, 0.012]} />
          <meshStandardMaterial color={a} roughness={0.95} />
        </mesh>
        <mesh position={[-0.13, 0.28, 0]} rotation={[0, 0, 0.22]} castShadow>
          <boxGeometry args={[0.1, 0.22, 0.01]} />
          <meshStandardMaterial color={b} roughness={0.95} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.21, 0.15, 0.32, 16]} />
        <meshStandardMaterial color={body} roughness={1} />
      </mesh>
      {/* Weave: three bands round the belly, each a different colour and radius so the basket
          reads as woven rather than as a painted bucket. */}
      {[0.07, 0.17, 0.27].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.16 + i * 0.026, 0.016, 8, 20]} />
          <meshStandardMaterial color={i % 2 ? a : b} roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, 0.33, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.21, 0.022, 8, 20]} />
        <meshStandardMaterial color={wood} roughness={0.9} />
      </mesh>
      {/* The handle, and the knot at one end that the description apologises for. */}
      <mesh position={[0, 0.33, 0]} castShadow>
        <torusGeometry args={[0.16, 0.02, 8, 16, Math.PI]} />
        <meshStandardMaterial color={wood} roughness={0.9} />
      </mesh>
      <mesh position={[0.15, 0.4, 0.01]} castShadow>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color={a} roughness={1} />
      </mesh>
    </group>
  );
}

/* --------------------------------------------- 圖騰石柱：三塊石頭真的疊在一起，而不是排在一起 */

/** 每塊石頭的高度，刻意大於 {@link TOTEM_BLOCK_STEP} —— 差值就是接縫的重疊量。 */
const TOTEM_BLOCK_H = 0.52;
/** 相鄰兩塊的中心距。 */
const TOTEM_BLOCK_STEP = 0.48;
/** 雕紋帶在石塊自己的局部高度。 */
const TOTEM_BAND_Y = 0.06;
/** 帶子凸出石塊表面多少。 */
const TOTEM_BAND_PROUD = 0.033;

/*
  收頭放緩：原本每一塊上下各收 3.5 公分，三塊從 0.34 收到 0.235，加上底座的 0.48，整根柱子的
  外輪廓是一個明顯的圓錐 —— 島上讀起來像一座燈塔或一堆石塚，而商店縮圖上的圖騰石柱是一根
  **上下差不多粗的直柱**，那是「圖騰柱」跟「石堆」的差別。現在每塊只收 1.4 公分（0.29 → 0.248），
  底座也從 0.42/0.48 收到 0.34/0.38，柱子因此站得起來而不是攤下去。
*/
const TOTEM_BLOCKS = [0, 1, 2].map((i) => {
  const rBottom = 0.290 - i * 0.014;
  const rTop = rBottom - 0.014;
  // 石塊在雕紋帶那個高度上的半徑 —— 圓錐插值，帶子就座落在它外面固定的距離上。
  const t = (TOTEM_BAND_Y + TOTEM_BLOCK_H / 2) / TOTEM_BLOCK_H;
  const rAtBand = rBottom + (rTop - rBottom) * t;
  return {
    y: 0.36 + i * TOTEM_BLOCK_STEP,
    rBottom,
    rTop,
    // 環的中心線略微縮進石面，所以帶子是「刻出來的一圈」而不是「套上去的一個環」。
    bandRadius: rAtBand + TOTEM_BAND_PROUD - 0.038,
  };
});

/** A standing statue: pedestal, body, head. `totem` stacks three carved blocks instead. */
function StatueModel({ spec }: { spec: ArtworkSpec }) {
  const base = spec.palette.frame ?? '#7d7568';
  const body = spec.palette.ground ?? '#a49a8b';
  const shade = spec.palette.a ?? '#5f594e';
  const accent = spec.palette.b ?? '#6b8f71';

  if (spec.variant === 'totem') {
    return (
      <group>
        <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.34, 0.38, 0.16, 8]} />
          <meshStandardMaterial color={base} roughness={1} />
        </mesh>
        {/*
          三塊疊起來的石塊 —— 這裡有兩個「疊起來」根本沒疊到的問題，是回報的圖騰石柱破圖。

          1. **石塊之間各有 4 公分的空隙。** 每塊高 0.48，但中心間距是 0.52，所以第一塊的頂面在
             0.58、第二塊的底面在 0.62 —— 兩塊之間看得見天空。三塊石頭中間浮著兩道縫。
             現在中心間距 0.48、塊高 0.52，**重疊** 4 公分而不是空 4 公分。
          2. **收頭反了。** 原本第 i 塊的頂半徑 0.30-0.03i、底半徑 0.34-0.03i，也就是下一塊的
             底部（0.31）比上一塊的頂部（0.30）**寬**，每一層接縫都往外凸出一圈唇邊，像疊錯了。
             現在上一塊的頂半徑等於下一塊的底半徑，整根柱子是一條連續的錐度。

          `receiveShadow` 也是這次補的：三塊石頭原本只投影不受影，所以上面那塊在下面那塊上的
          影子從來沒出現過，接縫處讀起來是平的。
        */}
        {TOTEM_BLOCKS.map((blk, i) => (
          <group key={i} position={[0, blk.y, 0]} rotation={[0, i * 0.35, 0]}>
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[blk.rTop, blk.rBottom, TOTEM_BLOCK_H, 8]} />
              <meshStandardMaterial color={i === 1 ? shade : body} roughness={1} />
            </mesh>
            {/* Carved band, standing proud of the block so the totem is not a smooth pillar.
                半徑是從石塊自己在那個高度的錐度取樣的，所以三道帶子凸出來的量都一樣。 */}
            <mesh position={[0, TOTEM_BAND_Y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <torusGeometry args={[blk.bandRadius, 0.038, 6, 16]} />
              <meshStandardMaterial color={i === 2 ? accent : base} roughness={1} />
            </mesh>
          </group>
        ))}
        {/*
          柱頂的雕紋。原本擺在 y=1.98、高 0.34，也就是底面在 1.81 —— 而最上面那塊石頭的頂面
          在 1.62。中間 19 公分是空的：一支浮在柱子上方的角。

          現在底面壓到 1.51，埋進頂塊 7 公分。前傾的角度與 z 位移一起選過，讓錐體的底圓在轉過來
          之後仍然完整落在頂塊的 0.235 半徑裡，不會有一邊懸空。
        */}
        <mesh position={[0, 1.72, 0.03]} rotation={[0.18, 0, 0]} castShadow receiveShadow>
          <coneGeometry args={[0.21, 0.42, 6]} />
          <meshStandardMaterial color={accent} roughness={1} />
        </mesh>
      </group>
    );
  }

  const isFigure = spec.variant === 'figure';
  return (
    <group>
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.18, 0.5]} />
        <meshStandardMaterial color={base} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.23, 0]} castShadow>
        <boxGeometry args={[0.5, 0.1, 0.4]} />
        <meshStandardMaterial color={shade} roughness={0.95} />
      </mesh>
      <mesh position={[0, isFigure ? 0.72 : 0.63, 0]} castShadow>
        {isFigure
          ? <cylinderGeometry args={[0.15, 0.24, 0.86, 12]} />
          : <boxGeometry args={[0.42, 0.68, 0.34]} />}
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
      <mesh position={[0, isFigure ? 1.26 : 1.09, 0]} scale={[1, 1.15, 0.9]} castShadow>
        <sphereGeometry args={[isFigure ? 0.15 : 0.2, 16, 14]} />
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
      {isFigure ? (
        // Arms, folded across the front — the only feature a featureless figure gets.
        <mesh position={[0, 0.82, 0.2]} rotation={[0.2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 0.42, 10]} />
          <meshStandardMaterial color={shade} roughness={0.95} />
        </mesh>
      ) : (
        // Two shallow grooves for eyes, which is all the description allows.
        ([-1, 1] as const).map((s) => (
          <mesh key={s} position={[s * 0.075, 1.12, 0.18]} castShadow>
            <boxGeometry args={[0.07, 0.026, 0.05]} />
            <meshStandardMaterial color={shade} roughness={1} />
          </mesh>
        ))
      )}
    </group>
  );
}

/** Large-format pottery standing on the ground. */
function UrnModel({ spec }: { spec: ArtworkSpec }) {
  const body = spec.palette.ground ?? '#b5714a';
  const shade = spec.palette.a ?? '#8a4f33';
  const rim = spec.palette.b ?? '#e0cbb0';

  const pot = (
    <>
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.26, 0.12, 20]} />
        <meshStandardMaterial color={shade} roughness={1} />
      </mesh>
      <mesh position={[0, 0.55, 0]} scale={[1, 1.05, 1]} castShadow>
        <sphereGeometry args={[0.5, 20, 16]} />
        <meshStandardMaterial color={body} roughness={1} />
      </mesh>
      <mesh position={[0, 1.03, 0]} castShadow>
        <cylinderGeometry args={[0.19, 0.34, 0.2, 20]} />
        <meshStandardMaterial color={body} roughness={1} />
      </mesh>
      <mesh position={[0, 1.15, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.2, 0.045, 8, 20]} />
        <meshStandardMaterial color={rim} roughness={0.9} />
      </mesh>
      {/* Shoulder band, where the widest part of the pot is. */}
      <mesh position={[0, 0.67, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.49, 0.035, 8, 24]} />
        <meshStandardMaterial color={shade} roughness={1} />
      </mesh>
    </>
  );

  if (!spec.outdoor) return <group>{pot}</group>;

  /*
    戶外陶甕。同一個甕，加上它站在戶外才有的東西 —— 而其中兩樣是這件商品的說明**已經寫了**、
    但模型上一直沒有的：「內壁積了一點雨水」與「青苔從底部爬上來，爬到第三年就停在同一個高度」。

    整個甕被抬高 0.10 站進碎石堆裡，而不是在原地多加一圈石頭：兩個底面都落在 y=0 會共平面
    （`npm run audit:placements` 的第三部分會抓），抬起來之後甕的底是埋在石頭裡的，這也正好是
    一個放在土上的甕該有的樣子。
  */
  return (
    <group>
      {/* 甕腳邊的碎石。三顆不同大小、不同角度 —— 規則排列會讀成裝飾線腳而不是石頭。 */}
      {([[0.7, 0.42, 0.115], [2.6, 0.46, 0.100], [4.6, 0.40, 0.130]] as [number, number, number][]).map(
        ([a, dist, r], i) => (
          <mesh
            key={`gravel-${i}`}
            position={[Math.cos(a) * dist, r * 0.9, Math.sin(a) * dist]}
            rotation={[i * 0.7, a, i * 0.4]}
            castShadow
            receiveShadow
          >
            <dodecahedronGeometry args={[r, 0]} />
            <meshStandardMaterial color={i === 1 ? '#9aa2a8' : '#b3b9bd'} roughness={0.95} />
          </mesh>
        )
      )}
      <group position={[0, 0.10, 0]}>
        {pot}
        {/* 青苔。停在同一個高度，就是甕身下緣那一圈。 */}
        {([[1.2, 0.30], [3.0, 0.24], [5.1, 0.34]] as [number, number][]).map(([a, y], i) => (
          <mesh
            key={`moss-${i}`}
            position={[Math.cos(a) * 0.43, y, Math.sin(a) * 0.43]}
            rotation={[0, -a, 0]}
            scale={[0.24, 1, 1]}
          >
            <sphereGeometry args={[0.16 + i * 0.015, 7, 5]} />
            <meshStandardMaterial color={i === 1 ? '#4e7a34' : '#5f8f3d'} roughness={1} />
          </mesh>
        ))}
        {/* 積在裡面的一點雨水。甕口內徑 0.19，水面就壓在口沿下面一點。 */}
        <mesh position={[0, 1.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.175, 16]} />
          <meshStandardMaterial color="#4a6b73" roughness={0.15} metalness={0.15} />
        </mesh>
      </group>
    </group>
  );
}

/** A sculpture presented on a display plinth. */
function PlinthModel({ spec }: { spec: ArtworkSpec }) {
  const plinth = spec.palette.frame ?? '#efe9dc';
  const piece = spec.palette.ground ?? '#2f3e46';
  const accent = spec.palette.a ?? '#c9a227';
  const isSphere = spec.variant === 'sphere';

  const core = (
    <>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.56, 1.0, 0.56]} />
        <meshStandardMaterial color={plinth} roughness={0.55} />
      </mesh>
      {/* Cap, a touch wider than the shaft so the plinth has an edge to catch light on.
          It SWALLOWS the top of the shaft rather than sitting on it: a 5cm cap perched on the
          shaft's top face left two up-facing surfaces 45mm apart, one covering the other, which
          is a z-fight at any camera distance (`npm run audit:zfighting` flagged exactly this).
          Deep enough that the shaft's own top face is buried well inside it. */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.64, 0.12, 0.64]} />
        <meshStandardMaterial color={plinth} roughness={0.4} />
      </mesh>
      {isSphere ? (
        <mesh position={[0, 1.28, 0]} castShadow>
          <sphereGeometry args={[0.26, 24, 20]} />
          <meshStandardMaterial color={piece} roughness={0.18} metalness={0.35} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 1.34, 0]} rotation={[0, 0.6, 0.25]} castShadow>
            <boxGeometry args={[0.16, 0.58, 0.16]} />
            <meshStandardMaterial color={piece} roughness={0.5} />
          </mesh>
          <mesh position={[0.11, 1.2, -0.06]} rotation={[0.3, -0.4, 0]} castShadow>
            <boxGeometry args={[0.13, 0.4, 0.13]} />
            <meshStandardMaterial color={accent} roughness={0.5} />
          </mesh>
        </>
      )}
    </>
  );

  if (!spec.outdoor) return <group>{core}</group>;

  /*
    露天展台。室內的展台站在地板上，戶外的站在草地上 —— 少了鋪面，它就是一根插在草裡的白柱子。

    整組抬高 0.12 疊在兩層鋪面上，而不是在原地補一塊板：柱身的底面本來就在 y=0，再放一塊也在
    y=0 的板子會共平面。抬起來之後柱底埋在上層台階裡，這也是台階本來的作用。
  */
  return (
    <group>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[0.94, 0.10, 0.94]} />
        <meshStandardMaterial color="#a8a49a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.13, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.09, 0.78]} />
        <meshStandardMaterial color="#bdb8ad" roughness={0.9} />
      </mesh>
      <group position={[0, 0.12, 0]}>
        {core}
        {/* 柱身正面的內凹嵌板與一片銅牌。一根四面全白的方柱在低多邊形裡沒有任何東西可以分出
            正面，嵌板一凹、銅牌一掛，玩家就知道要從哪一面看它。 */}
        <mesh position={[0, 0.56, 0.279]}>
          <boxGeometry args={[0.40, 0.68, 0.012]} />
          <meshStandardMaterial color="#b7b1a4" roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.26, 0.292]} castShadow>
          <boxGeometry args={[0.22, 0.10, 0.016]} />
          <meshStandardMaterial color={accent} metalness={0.55} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

/** A large installation: a walk-through arch, or a kinetic mobile on a mast. */
/* ------------------------------------------------------------- 風動雕塑：真的會被風轉的那一件 */

/**
 * 兩層吊臂的高度。上下分層是這件作品原本就有的構圖，動起來之後它變成兩個反向的轉子。
 *
 * **兩層都被抬高了**（1.30 / 1.72 → 1.50 / 1.86），而這是動畫逼出來的，不是美術偏好。碰撞外框
 * 是從**靜止姿勢**量出來的（lib/collisionShape.ts 按高度切片），而靜止時下層只有兩片葉子指著
 * 一個方向 —— 一旦它會轉，葉子就會轉到外框沒有涵蓋的方向去，玩家會從一片正在轉的葉子中間走過去。
 *
 * 原本下層葉片的最低點在 1.62 世界單位，正好落在行走碰撞帶（0.25–1.75）裡。抬到 1.50 之後最低點
 * 是 1.80，整組會轉的東西都在頭頂上方 —— 碰撞外框裡只剩下不會轉的桅杆，於是「外框是靜止姿勢」
 * 這件事再也不會跟動畫矛盾。真實世界的風動雕塑掛那麼高也是同一個理由。
 */
const MOBILE_TIERS = [1.50, 1.86] as const;
/** 銷軸從桅杆伸出去多遠 —— 葉片就吊在它的外端。 */
const MOBILE_PIN_END = 0.115;
/**
 * 葉片中心相對銷軸端點的位置。
 *
 * 從「葉片內端要正好落在銷軸上」倒推出來的：葉片半長 0.22、下垂 0.30 弧度，所以中心必須在
 * (0.22·cos 0.30, −0.22·sin 0.30) = (0.210, −0.065)，再往內收 1.5 公分讓內端埋進銷軸裡。
 *
 * 改版前這裡是寫死的 `position={[0.28, 0, 0]} rotation={[0, 0, 0.35]}`，葉片的內端因此落在銷軸
 * **下方 7.5 公分**：四片葉子全部浮在半空中，跟桅杆沒有任何接觸。那是這件作品的破圖。
 */
const MOBILE_BLADE_TILT = -0.30;
const MOBILE_BLADE_CENTER: [number, number, number] = [0.195, -0.060, 0];

function WindMobileModel({
  frame, body, a, b, instanceId,
}: { frame: string; body: string; a: string; b: string; instanceId?: string }) {
  const rootRef = useRef<THREE.Group>(null);
  const lowerRef = useRef<THREE.Group>(null);
  const upperRef = useRef<THREE.Group>(null);

  /*
    兩層各自轉，而且轉向相反 —— 「依照模型結構判斷適合的動法」在這件東西上的答案。

    整座雕塑晃動是不對的：它的底座是一塊 0.46 半徑的實心石頭，晃的只會是掛在桅杆上的東西。
    所以桅杆與底座完全不動，動的是兩層吊臂，而它們的角速度是**陣風的積分**
    （lib/outdoorMotion.ts 的 `windRotorAngle`）：陣風強的時候轉得快、風停的時候幾乎停住，
    但永遠不會倒轉。這就是「自然速度變化 + 不完全固定的節奏」，而且因為是封閉解，被裁掉的
    幀不會讓它落後。

    `tilt` 讓轉軸本身跟著風微微歪一點，雕塑才讀成「吊著的」而不是「裝在馬達上的」。
  */
  useWindRotor(rootRef, lowerRef, WIND_ROTORS.mobile, { seed: instanceId, tilt: 0.05, radius: 1.6 });
  useWindRotor(rootRef, upperRef, WIND_ROTORS.mobileUpper, { seed: instanceId, tilt: 0.07, radius: 1.6 });

  const arm = (i: number) => (
    <group key={i} rotation={[0, (i / 4) * Math.PI * 2, 0]}>
      <mesh position={[0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.14, 8]} />
        <meshStandardMaterial color={frame} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* 葉片吊在銷軸的外端。旋轉中心就是接點，所以它不可能跟銷軸分開。 */}
      {/* 葉片吊在銷軸的外端，做成**橢圓**的薄片而不是長方板。商店縮圖上這件動態雕塑的三片
          葉子都是斜掛的橢圓，那個圓潤的輪廓是它跟旁邊四方的展台雕塑分開的地方；一塊 0.44×0.24
          的方板在島上讀成一片木片。壓扁的球給的是同樣的長寬、同一個 mesh，換來一個對得上的輪廓。 */}
      <group position={[MOBILE_PIN_END, 0, 0]}>
        <mesh
          position={MOBILE_BLADE_CENTER}
          rotation={[0, 0, MOBILE_BLADE_TILT]}
          scale={[1, 0.09, 0.55]}
          castShadow
        >
          <sphereGeometry args={[0.22, 12, 7]} />
          <meshStandardMaterial color={i % 2 ? a : b} roughness={0.45} metalness={0.3} />
        </mesh>
      </group>
    </group>
  );

  return (
    <group ref={rootRef}>
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.4, 0.46, 0.14, 16]} />
        <meshStandardMaterial color={body} roughness={0.9} />
      </mesh>
      {/* 桅杆跟著上層吊臂一起長高，頂端仍然比最上面那一層高出一截。 */}
      <mesh position={[0, 1.13, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 2.06, 12]} />
        <meshStandardMaterial color={frame} roughness={0.5} metalness={0.4} />
      </mesh>
      <group ref={lowerRef} position={[0, MOBILE_TIERS[0], 0]}>
        {[0, 2].map(arm)}
      </group>
      <group ref={upperRef} position={[0, MOBILE_TIERS[1], 0]}>
        {[1, 3].map(arm)}
      </group>
    </group>
  );
}

function InstallationModel({ spec, instanceId }: { spec: ArtworkSpec; instanceId?: string }) {
  const frame = spec.palette.frame ?? '#e8e2d4';
  const body = spec.palette.ground ?? '#d6cec1';
  const a = spec.palette.a ?? '#2a9d8f';
  const b = spec.palette.b ?? '#e07a5f';
  /** 石作的暗面 —— 底腳、柱頭、外拱線。拱門沒有宣告 `b`，所以它拿這個中性石色。 */
  const shade = spec.palette.b ?? '#b6ad9c';

  if (spec.variant === 'mobile') {
    return <WindMobileModel frame={frame} body={body} a={a} b={b} instanceId={instanceId} />;
  }

  /*
    海風拱門。兩根柱子撐一道拱 —— 改版前就是照字面做的：兩塊墊石、兩根光柱、一道半圓、一顆
    拱心石，六個 mesh。問題是「柱子」這個東西在建築上從來不是一根管子：它有柱礎、有柱身、
    有柱頭，少了那兩端，它讀起來是水管而不是石柱。

    每根柱子現在是五段：底腳 → 柱礎 → 柱身 → 頸環 → 柱頭。拱本身多了一圈外拱線，
    讓那道半圓有厚薄兩層而不是一條等寬的帶子。
  */
  return (
    <group>
      {([-1, 1] as const).map((s) => (
        <group key={s} position={[s * 0.72, 0, 0]}>
          {/* 底腳。壓在地上比柱礎再寬一圈。 */}
          <mesh position={[0, 0.05, 0]} receiveShadow>
            <boxGeometry args={[0.56, 0.10, 0.56]} />
            <meshStandardMaterial color={shade} roughness={0.95} />
          </mesh>
          {/* 柱礎 */}
          <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.44, 0.14, 0.44]} />
            <meshStandardMaterial color={body} roughness={0.9} />
          </mesh>
          {/* 柱身 */}
          <mesh position={[0, 0.98, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.185, 1.58, 14]} />
            <meshStandardMaterial color={frame} roughness={0.75} />
          </mesh>
          {/* 柱腳環。柱身插進柱礎的地方，一圈環把接縫收掉。 */}
          <mesh position={[0, 0.26, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.185, 0.035, 6, 14]} />
            <meshStandardMaterial color={body} roughness={0.85} />
          </mesh>
          {/* 柱頸環 */}
          <mesh position={[0, 1.60, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.152, 0.03, 6, 14]} />
            <meshStandardMaterial color={body} roughness={0.85} />
          </mesh>
          {/* 柱頭。拱就落在它上面。
              柱身頂面在 1.77，柱頭做到 1.68–1.86，也就是柱子的斷面被埋進柱頭裡 9 公分 ——
              跟 PlinthModel 的頂蓋同一個做法，理由也一樣：兩個相距 5 公釐、互相遮蓋的朝上面
              在任何鏡頭距離都會閃。 */}
          <mesh position={[0, 1.77, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.42, 0.18, 0.42]} />
            <meshStandardMaterial color={shade} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* 外拱線。比主拱大一圈、薄一半，所以那道拱有兩層厚度而不是一條等寬的帶子。 */}
      <mesh position={[0, 1.79, 0]} castShadow>
        <torusGeometry args={[0.86, 0.07, 8, 26, Math.PI]} />
        <meshStandardMaterial color={shade} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.79, 0]} castShadow>
        <torusGeometry args={[0.72, 0.15, 12, 26, Math.PI]} />
        <meshStandardMaterial color={frame} roughness={0.75} />
      </mesh>
      {/* Keystone, so the arch has a middle rather than being a bent tube. */}
      <mesh position={[0, 2.46, 0]} castShadow>
        <boxGeometry args={[0.3, 0.22, 0.34]} />
        <meshStandardMaterial color={a} roughness={0.7} />
      </mesh>
    </group>
  );
}

// --- Dispatch ----------------------------------------------------------------------------------

/**
 * The 3D model for an artwork.
 *
 * Reached from `FurnitureModel` before it consults its name-keyed registry, so an artwork never
 * needs an entry in that table — which is what keeps a forty-piece catalog from turning into forty
 * more registry lines that have to stay in the right order relative to each other.
 */
export function ArtworkModel({ spec, scale = 1, instanceId }: ArtworkModelProps) {
  const [w, h] = spec.size ?? [1.4, 1.1];

  return (
    <group scale={scale}>
      {renderForm(spec, w, h, instanceId)}
    </group>
  );
}

function renderForm(spec: ArtworkSpec, w: number, h: number, instanceId?: string): React.ReactElement {
  switch (spec.form) {
    case 'framed': return <FramedModel spec={spec} w={w} h={h} bar={0.09} depth={0.09} />;
    case 'canvas': return <CanvasModel spec={spec} w={w} h={h} />;
    case 'oil': return <OilModel spec={spec} w={w} h={h} />;
    case 'poster': return <PosterModel spec={spec} w={w} h={h} />;
    case 'tapestry': return <TapestryModel spec={spec} w={w} h={h} />;
    case 'macrame': return <MacrameModel spec={spec} w={w} h={h} />;
    case 'relief': return <ReliefModel spec={spec} w={w} h={h} />;
    case 'gallery': return <GalleryModel spec={spec} w={w} h={h} />;
    case 'charm': return <CharmModel spec={spec} w={w} h={h} />;
    case 'figurine': return <FigurineModel spec={spec} />;
    case 'vessel': return <VesselModel spec={spec} />;
    case 'vase': return <VaseModel spec={spec} />;
    case 'objet': return <ObjetModel spec={spec} />;
    case 'plate': return <PlateModel spec={spec} />;
    case 'crystal': return <CrystalModel spec={spec} />;
    case 'craft': return <CraftModel spec={spec} />;
    case 'statue': return <StatueModel spec={spec} />;
    case 'urn': return <UrnModel spec={spec} />;
    case 'floorvase': return <VaseModel spec={spec} tall />;
    case 'plinth': return <PlinthModel spec={spec} />;
    case 'installation': return <InstallationModel spec={spec} instanceId={instanceId} />;
  }
}
