/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactElement } from 'react';
import { COSMETIC_PALETTE, getSpecialCosmetic } from '../constants/cosmeticEffects';

/**
 * SHOP ICONS FOR SPECIAL COSMETICS.
 *
 * QVersionIcon.tsx is a ~100-case exact-id ladder, and its own doc comments say what to do
 * instead where a family of items shares a structure: trousers, house styles and hair all
 * resolve from their catalog entry rather than getting a hand-drawn branch each. Special
 * cosmetics are such a family, so they resolve here — a new ornament needs a glyph in
 * {@link GLYPHS} and nothing else, and it CANNOT end up on the grey placeholder box, because
 * the id prefix dispatches before the ladder is reached.
 *
 * Every glyph reads its colours from COSMETIC_PALETTE, the same table the 3D models and the
 * particles read. That is the point: the star in the shop is the colour of the star in the
 * player's hair, and it stays that way when the palette is retuned.
 */

/** Drawn on the 64x64 viewBox QVersionIcon uses, with its cozy brown outline. */
interface GlyphProps {
  strokeColor: string;
  strokeWidth: string;
}

/** A four-pointed star, the same silhouette as the 3D octahedron and its particles. */
function StarShape({ cx, cy, r, fill, stroke, strokeWidth }: {
  cx: number; cy: number; r: number; fill: string; stroke: string; strokeWidth: string;
}) {
  const w = r * 0.36;
  return (
    <path
      d={`M${cx} ${cy - r} Q${cx + w} ${cy - w} ${cx + r} ${cy} Q${cx + w} ${cy + w} ${cx} ${cy + r} Q${cx - w} ${cy + w} ${cx - r} ${cy} Q${cx - w} ${cy - w} ${cx} ${cy - r} Z`}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}

function StarPinGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.starlight;
  return (
    <>
      <rect x="14" y="40" width="26" height="7" rx="3.5" transform="rotate(-14 14 40)" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} />
      <StarShape cx={34} cy={27} r={17} fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} />
      <StarShape cx={49} cy={14} r={7} fill={p.glow} stroke={strokeColor} strokeWidth="2" />
    </>
  );
}

function ForestCrownGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.forest;
  return (
    <>
      <ellipse cx="32" cy="36" rx="22" ry="15" fill="none" stroke={p.deep} strokeWidth="6" />
      <ellipse cx="32" cy="36" rx="22" ry="15" fill="none" stroke={strokeColor} strokeWidth="1.6" opacity="0.5" />
      {/* Blooms around the front of the ring. */}
      <circle cx="14" cy="34" r="6" fill={p.bloom} stroke={strokeColor} strokeWidth="2" />
      <circle cx="32" cy="51" r="7" fill={p.glow} stroke={strokeColor} strokeWidth="2" />
      <circle cx="50" cy="34" r="6" fill={p.bloom} stroke={strokeColor} strokeWidth="2" />
      <circle cx="32" cy="51" r="2.4" fill="#f6e2a8" />
      {/* Leaves */}
      <path d="M22 22C16 18 12 20 12 26C18 28 21 27 22 22Z" fill={p.body} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      <path d="M42 22C48 18 52 20 52 26C46 28 43 27 42 22Z" fill={p.body} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
    </>
  );
}

function BubblePinGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.bubble;
  return (
    <>
      <rect x="16" y="44" width="24" height="7" rx="3.5" transform="rotate(-12 16 44)" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} />
      <circle cx="27" cy="33" r="14" fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} opacity="0.92" />
      <circle cx="45" cy="22" r="9" fill={p.glow} stroke={strokeColor} strokeWidth="2" opacity="0.92" />
      <circle cx="41" cy="41" r="6" fill={p.glow} stroke={strokeColor} strokeWidth="2" opacity="0.92" />
      {/* Highlights — the one thing that makes a flat disc read as glass. */}
      <circle cx="22" cy="28" r="3.4" fill="#ffffff" opacity="0.85" />
      <circle cx="42" cy="19" r="2" fill="#ffffff" opacity="0.85" />
    </>
  );
}

function FlameCharmGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.campfire;
  return (
    <>
      {/* Cord */}
      <path d="M20 10C24 16 30 18 32 20" stroke="#8a7355" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M44 10C40 16 34 18 32 20" stroke="#8a7355" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Brass cup */}
      <path d="M22 44H42L38 54H26L22 44Z" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {/* Flame */}
      <path d="M32 16C40 26 43 33 43 39C43 45 38 48 32 48C26 48 21 45 21 39C21 33 24 26 32 16Z" fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M32 28C36 34 37 37 37 40C37 43.5 35 45 32 45C29 45 27 43.5 27 40C27 37 28 34 32 28Z" fill={p.glow} />
    </>
  );
}

function ButterflyGlyph({ strokeColor, strokeWidth, wing, edge, clip }: GlyphProps & {
  wing: string; edge: string; clip?: string;
}): ReactElement {
  return (
    <>
      {clip && <rect x="16" y="46" width="26" height="7" rx="3.5" transform="rotate(-10 16 46)" fill={clip} stroke={strokeColor} strokeWidth={strokeWidth} />}
      {/* Forewings */}
      <path d="M31 30C24 16 14 12 10 18C6 24 14 34 30 34Z" fill={wing} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M33 30C40 16 50 12 54 18C58 24 50 34 34 34Z" fill={wing} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {/* Hindwings */}
      <path d="M30 34C20 36 14 40 17 45C20 50 28 44 31 38Z" fill={edge} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      <path d="M34 34C44 36 50 40 47 45C44 50 36 44 33 38Z" fill={edge} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      {/* Body and antennae */}
      <rect x="30" y="20" width="4" height="24" rx="2" fill="#4a3f52" stroke={strokeColor} strokeWidth="1.6" />
      <path d="M31 20C29 15 26 13 24 13M33 20C35 15 38 13 40 13" stroke="#4a3f52" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  );
}

function ButterflyClipGlyph(props: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.butterfly;
  return <ButterflyGlyph {...props} wing={p.body} edge={p.glow} clip={p.deep} />;
}

function PetBowGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.flower;
  return (
    <>
      {/* Tails */}
      <path d="M26 34L16 54L27 48Z" fill={p.deep} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      <path d="M38 34L48 54L37 48Z" fill={p.deep} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      {/* Loops */}
      <path d="M28 28C20 18 8 18 8 28C8 38 20 38 28 32Z" fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M36 28C44 18 56 18 56 28C56 38 44 38 36 32Z" fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {/* Knot */}
      <circle cx="32" cy="30" r="8" fill={p.glow} stroke={strokeColor} strokeWidth={strokeWidth} />
    </>
  );
}

function PetMushroomGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  return (
    <>
      {/* Stem */}
      <path d="M24 36H40L38 54H26L24 36Z" fill="#f4ece0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {/* Cap */}
      <path d="M8 36C8 20 18 10 32 10C46 10 56 20 56 36Z" fill="#e0796f" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <ellipse cx="20" cy="26" rx="5" ry="4" fill="#fdf6ec" />
      <ellipse cx="36" cy="20" rx="6" ry="4.6" fill="#fdf6ec" />
      <ellipse cx="46" cy="30" rx="4.4" ry="3.4" fill="#fdf6ec" />
    </>
  );
}

function PetBeehiveGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.honey;
  return (
    <>
      <ellipse cx="32" cy="50" rx="24" ry="8" fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} />
      <ellipse cx="32" cy="38" rx="21" ry="8" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} />
      <ellipse cx="32" cy="27" rx="17" ry="7" fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} />
      <ellipse cx="32" cy="17" rx="11" ry="6" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* Entrance */}
      <ellipse cx="32" cy="46" rx="6" ry="5" fill="#4a3520" stroke={strokeColor} strokeWidth="2" />
      {/* One bee out front, which is what the ornament actually does. */}
      <ellipse cx="52" cy="16" rx="5" ry="3.6" fill={p.body} stroke={strokeColor} strokeWidth="1.8" />
      <path d="M51 13C49 10 46 10 45 12" stroke="#eaf4fa" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </>
  );
}

/** The band both pet collars share, drawn once for the same reason the 3D one is shared. */
function CollarBandShape({ colour, strokeColor, strokeWidth }: GlyphProps & { colour: string }): ReactElement {
  return (
    <>
      <path d="M10 22C10 34 20 42 32 42C44 42 54 34 54 22" fill="none" stroke={colour} strokeWidth="10" strokeLinecap="round" />
      <path d="M10 22C10 34 20 42 32 42C44 42 54 34 54 22" fill="none" stroke={strokeColor} strokeWidth="1.6" opacity="0.45" />
    </>
  );
}

function PetStarCollarGlyph(props: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.starlight;
  return (
    <>
      <CollarBandShape {...props} colour="#6f8fa8" />
      <circle cx="32" cy="45" r="4" fill="none" stroke="#cfd8e0" strokeWidth="3" />
      <StarShape cx={32} cy={54} r={9} fill={p.body} stroke={props.strokeColor} strokeWidth="2" />
    </>
  );
}

function PetFlowerCollarGlyph(props: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.flower;
  const blooms: Array<[number, number, number, string]> = [
    [15, 31, 6, p.deep],
    [32, 42, 7.5, p.body],
    [49, 31, 6, p.glow],
  ];
  return (
    <>
      <CollarBandShape {...props} colour="#8fbf7a" />
      {blooms.map(([cx, cy, r, colour]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={r} fill={colour} stroke={props.strokeColor} strokeWidth="2" />
          <circle cx={cx} cy={cy} r={r * 0.32} fill="#f6e2a8" />
        </g>
      ))}
    </>
  );
}

/**
 * 星軌之翼. Drawn FROM BEHIND — the one view that says "wings" in a 64px square.
 *
 * Every other glyph here is a three-quarter view of a small object, which works because a
 * hairpin or a collar is legible from any angle. A pair of wings is not: seen from the side it
 * is one wing, and seen from the front it is two slivers. So this is the silhouette the
 * third-person camera actually shows, which is also the one the player will recognise on the
 * character afterwards.
 */
function StarWingsGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.starlight;

  /**
   * ONE SILHOUETTE PER WING, not a fan of separate quills.
   *
   * Two failed passes are why. Drawn as thick strokes the fan is a pale smear — starlight is
   * the lightest palette in the game and has no edge of its own on a cream card. Drawn as four
   * filled diamonds it is worse: at 64px the shop's outline is ~3 units wide against a quill
   * ~10 wide, and four overlapping outlines stack into a black blob. Every glyph in this file
   * that works (the butterfly, the mushroom, the bow) is two or three BIG filled shapes with
   * one outline each, and this is that: a wing outline with the feather separations drawn as
   * notches in the trailing edge, which costs no extra strokes at all.
   */
  const WING = 'M33 43 C37 27 46 17 60 13 L51 26 L55 29 L45 35 L48 38 L37 44 Z';

  return (
    <>
      {[1, -1].map(side => (
        <g key={side} transform={side === 1 ? undefined : 'translate(64,0) scale(-1,1)'}>
          <path
            d={WING}
            fill={p.body}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          {/* The shaft. One thin line is all the interior detail this size can carry, and it is
              what stops the wing reading as a flat leaf. */}
          <path d="M35 42 L55 21" stroke={p.deep} strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </g>
      ))}
      {/* The clasp at the spine, holding the pair together. */}
      <StarShape cx={32} cy={41} r={8} fill={p.glow} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* One shed feather below, because the trail is half of what the item is. */}
      <path
        d="M32 50 L35 56 L32 62 L29 56 Z"
        fill={p.deep}
        stroke={strokeColor}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * 精靈光環. A ring seen at a slight angle, with its three lights and a ripple under it.
 *
 * Drawn as an ELLIPSE rather than a circle for the same reason the wings glyph is drawn from
 * behind: a halo seen face-on is a circle, and a circle in a 64px square is a letter O. The
 * perspective squash is what says "this is a ring lying flat, above something".
 */
function SpiritHaloGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.starlight;
  const motes: Array<[number, number, number]> = [[13, 26, 4.5], [51, 26, 4], [32, 33, 3.4]];
  return (
    <>
      {/* The expanding ripple, faint and underneath — the night half of the item. */}
      <ellipse cx="32" cy="46" rx="26" ry="10" fill="none" stroke={p.deep} strokeWidth="2" opacity="0.5" />
      <ellipse cx="32" cy="42" rx="17" ry="6.5" fill="none" stroke={p.deep} strokeWidth="2.4" opacity="0.75" />
      {/* The ring itself. Two strokes: the pale band, then the shop's brown edge over it at half
          weight, because a full-weight outline on a 5-unit band leaves no band. */}
      <ellipse cx="32" cy="26" rx="21" ry="8" fill="none" stroke={p.body} strokeWidth="7" />
      <ellipse cx="32" cy="26" rx="21" ry="8" fill="none" stroke={strokeColor} strokeWidth="1.5" opacity="0.75" />
      <ellipse cx="32" cy="26" rx="21" ry="8" fill="none" stroke={p.glow} strokeWidth="2.6" />
      {motes.map(([cx, cy, r]) => (
        <circle key={cx} cx={cx} cy={cy} r={r} fill={p.glow} stroke={strokeColor} strokeWidth={strokeWidth} />
      ))}
    </>
  );
}

/**
 * A cloud silhouette as ONE closed path: three arcs over a flat base.
 *
 * Shared by 小雨雲 and 雲朵背包 for the same reason CloudPuffs is shared by their 3D models —
 * two items in one series have to be made of the same cloud, and two hand-drawn clouds are not.
 */
function CloudShape({ cx, cy, w, fill, stroke, strokeWidth }: {
  cx: number; cy: number; w: number; fill: string; stroke: string; strokeWidth: string;
}) {
  const s = w / 44;
  const d = `M${cx - 22 * s} ${cy + 7 * s}`
    + ` a${9 * s} ${9 * s} 0 0 1 ${1 * s} ${-17 * s}`
    + ` a${11 * s} ${11 * s} 0 0 1 ${19 * s} ${-6 * s}`
    + ` a${10 * s} ${10 * s} 0 0 1 ${17 * s} ${9 * s}`
    + ` a${8 * s} ${8 * s} 0 0 1 ${-3 * s} ${14 * s}`
    + ` Z`;
  return <path d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />;
}

function RainCloudGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.cloud;
  const drops: Array<[number, number]> = [[19, 46], [32, 52], [45, 46]];
  return (
    <>
      <CloudShape cx={32} cy={26} w={50} fill={p.glow} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* The underside, in the shade tint — the same bottom the 3D cloud has, and what stops a
          flat white shape from reading as a blob. */}
      <path d="M11 33 Q32 40 53 33 L53 34 Q32 41 11 34 Z" fill={p.deep} stroke="none" opacity="0.8" />
      {drops.map(([x, y]) => (
        <path
          key={x}
          d={`M${x} ${y - 6} L${x + 3.4} ${y} L${x} ${y + 6} L${x - 3.4} ${y} Z`}
          fill={COSMETIC_PALETTE.bubble.body}
          stroke={strokeColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

function PetBellCollarGlyph(props: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.music;
  return (
    <>
      <CollarBandShape {...props} colour={p.deep} />
      <circle cx="32" cy="47" r="13" fill={p.glow} stroke={props.strokeColor} strokeWidth={props.strokeWidth} />
      {/* Equator and slot: the two marks that turn a circle into a bell. */}
      <path d="M19.5 47 L44.5 47" stroke={props.strokeColor} strokeWidth="2.2" />
      <rect x="27" y="54" width="10" height="4" rx="2" fill={p.deep} stroke={props.strokeColor} strokeWidth="1.6" />
    </>
  );
}

/**
 * A scallop: a fan with a hinge nub at the point.
 *
 * Shared by the ocean pair. The first pass drew it as a bare fan and it read as a folded paper
 * hat — the nub at the bottom and the ribs reaching the full height of the fan are the two marks
 * that make it a shell, and neither is optional.
 */
function ScallopShape({ cx, cy, r, props, fill, rib }: {
  cx: number; cy: number; r: number; props: GlyphProps; fill: string; rib: string;
}) {
  const ribs = [-0.62, -0.31, 0, 0.31, 0.62];
  return (
    <g>
      <path
        d={`M${cx} ${cy} L${cx - r} ${cy - r * 0.72} A${r} ${r} 0 0 1 ${cx + r} ${cy - r * 0.72} Z`}
        fill={fill}
        stroke={props.strokeColor}
        strokeWidth={props.strokeWidth}
        strokeLinejoin="round"
      />
      {ribs.map(a => (
        <path
          key={a}
          d={`M${cx} ${cy} L${cx + Math.sin(a) * r * 0.94} ${cy - r * 0.72 - Math.cos(a) * r * 0.5}`}
          stroke={rib}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      ))}
      {/* The hinge. */}
      <circle cx={cx} cy={cy} r={r * 0.17} fill={rib} stroke={props.strokeColor} strokeWidth="1.6" />
    </g>
  );
}

function TidePendantGlyph(props: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.ocean;
  return (
    <>
      {/* Cord. */}
      <path d="M20 6 Q32 16 44 6" fill="none" stroke={p.deep} strokeWidth="3" strokeLinecap="round" />
      {/* The two ripples the item actually emits, drawn as the thing above the shell. The first
          pass put a wave curl here and it read as a fern frond: a spiral at 64px is a spiral. */}
      <ellipse cx="32" cy="21" rx="24" ry="8" fill="none" stroke={p.deep} strokeWidth="2.2" opacity="0.55" />
      <ellipse cx="32" cy="20" rx="15" ry="5" fill="none" stroke={p.body} strokeWidth="3" />
      <ScallopShape cx={32} cy={58} r={22} props={props} fill={p.sand} rib={p.deep} />
    </>
  );
}

function PetShellCollarGlyph(props: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.ocean;
  return (
    <>
      <CollarBandShape {...props} colour={p.deep} />
      <ScallopShape cx={32} cy={60} r={19} props={props} fill={p.sand} rib={p.deep} />
    </>
  );
}

function MusicBoxGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.music;
  return (
    <>
      {/* A note escaping. Kept fully inside the 64px square — the first pass ran its stem off
          the top edge, so the shop card showed a note with no stem. */}
      <ellipse cx="15" cy="22" rx="6.5" ry="5" transform="rotate(-20 15 22)" fill={p.glow} stroke={strokeColor} strokeWidth="2" />
      <path d="M20.5 20 L20.5 8" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" />
      {/* The lid, HINGED at the box's own top-left corner rather than floating near it. Two
          earlier passes drew it detached — first as a parallelogram over a parallelogram body
          (which read as a photocopier), then as a loose pill (which read as nothing at all).
          A lid has to touch the box it belongs to. */}
      <rect
        x="30" y="28" width="30" height="7" rx="2"
        transform="rotate(-28 30 35)"
        fill={p.body}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      {/* Body. */}
      <rect x="16" y="34" width="32" height="21" rx="3" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* The pinned cylinder, which is the part that says "this plays". */}
      <rect x="21" y="39" width="22" height="9" rx="4.5" fill={p.glow} stroke={strokeColor} strokeWidth="2" />
      <path d="M27 39 L27 48 M32 39 L32 48 M37 39 L37 48" stroke={p.deep} strokeWidth="1.6" />
    </>
  );
}

function PetCloudPackGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.cloud;
  return (
    <>
      <CloudShape cx={32} cy={24} w={50} fill={p.glow} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* Underside shade, so a white cloud on a cream card is not a blank space. */}
      <path d="M11 31 Q32 39 53 31 L53 33 Q32 41 11 33 Z" fill={p.deep} stroke="none" />
      {/* The strap: a band ACROSS the bundle with a buckle, which is the mark that says "worn".
          Drawn behind the cloud it read as a shadow; drawn as a V under it, it read as a
          slingshot. A strap has to cross the thing it is holding. */}
      <rect x="8" y="36" width="48" height="9" rx="4.5" fill={p.deep} stroke={strokeColor} strokeWidth={strokeWidth} />
      <rect x="26" y="33" width="12" height="15" rx="3" fill={p.glow} stroke={strokeColor} strokeWidth="2" />
    </>
  );
}

function OceanAnkletGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.ocean;
  const beads: Array<[number, number, number, string]> = [
    [13, 33, 5.5, p.sand], [22, 39, 4.5, p.body], [32, 41.5, 6, p.glow],
    [42, 39, 4.5, p.body], [51, 33, 5.5, p.sand],
  ];
  return (
    <>
      {/* A LEG AND A FOOT, not a rectangle. A band on its own at 64px is a band — what says
          "ankle" is the thing it is worn on, and the first pass drew that as a plain tan bar,
          which reads as a plank with beads on it. The taper and the foot are the whole message. */}
      <path
        d="M25 2 L39 2 L37 40 Q37 47 41 51 L47 57 Q49 60 45 60 L27 60 Q24 60 24 56 L25 40 Z"
        fill="#e8d7c3"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* The cord, passing behind the leg. */}
      <path d="M11 33 Q32 47 53 33" fill="none" stroke={p.deep} strokeWidth="4" strokeLinecap="round" />
      {beads.map(([cx, cy, r, fill]) => (
        <circle key={cx} cx={cx} cy={cy} r={r} fill={fill} stroke={strokeColor} strokeWidth={strokeWidth} />
      ))}
    </>
  );
}

function BloomCircleGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.flower;
  const f = COSMETIC_PALETTE.forest;
  // An ELLIPSE, not a circle: this is a ring lying on the floor, and the perspective squash is
  // the only thing in a 64px square that can say "flat on the ground" rather than "hoop standing
  // up". Same reasoning as the halo glyph.
  //
  // No feet. The first pass drew two standing inside the ring to say "around you", and at this
  // size the top bloom landed on top of them — two shapes fighting for the same 10 pixels, and
  // neither won. The squash alone carries it.
  const blooms: Array<[number, number, number]> = [
    [6, 36, 6.5], [18, 48, 7.5], [32, 51, 7], [46, 48, 7.5], [58, 36, 6.5],
    [22, 26, 5.5], [42, 26, 5.5],
  ];
  return (
    <>
      <ellipse cx="32" cy="38" rx="27" ry="13" fill="none" stroke={f.deep} strokeWidth="7" />
      <ellipse cx="32" cy="38" rx="27" ry="13" fill="none" stroke={strokeColor} strokeWidth="1.5" opacity="0.5" />
      {blooms.map(([cx, cy, r]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={r} fill={p.body} stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx={cx} cy={cy} r={r * 0.34} fill={p.heart} />
        </g>
      ))}
    </>
  );
}

/** Model key → glyph. Keyed on the same `model` field the 3D registry uses, so the two lists
 *  are checked against each other by the eye in one place instead of drifting apart. */
/**
 * 結霜光環. The same ellipse-in-perspective the spirit halo uses, and everything else different.
 *
 * The two halos have to be told apart at 64 px, which is a harder problem than telling them apart
 * in the world: at thumbnail size the perspective ellipse IS the item, so drawing the second one
 * with a different tint and nothing else would produce two cards a player reads as a palette
 * swap. So this one puts SPIKES on the ring — a jagged outline against a smooth one — and hangs a
 * snowflake under it, which is the one symbol nothing else on the shelf can be confused with.
 */
function FrostHaloGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.frost;
  /** x, tip-y, half-width — the spikes standing off the ring's near and far edges. */
  const spikes: Array<[number, number, number]> = [
    [13, 12, 3.4], [24, 6, 3.8], [40, 7, 3.6], [51, 13, 3.2],
  ];
  return (
    <>
      {/* Frost haze under the ring. */}
      <ellipse cx="32" cy="30" rx="27" ry="11" fill={p.body} opacity="0.22" />
      {spikes.map(([x, tip, w]) => (
        <path
          key={x}
          d={`M${x - w} 24 L${x} ${tip} L${x + w} 24 Z`}
          fill={p.ice}
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ))}
      {/* The hoop. Same three-stroke build as the spirit halo's — pale band, thin brown edge over
          it, bright highlight — because they are the same OBJECT drawn in two materials, and the
          shelf should say so even while the spikes say they are not the same item. */}
      <ellipse cx="32" cy="26" rx="21" ry="8" fill="none" stroke={p.body} strokeWidth="7" />
      <ellipse cx="32" cy="26" rx="21" ry="8" fill="none" stroke={strokeColor} strokeWidth="1.5" opacity="0.75" />
      <ellipse cx="32" cy="26" rx="21" ry="8" fill="none" stroke={p.glow} strokeWidth="2.6" />
      {/* Two shards riding outside it. */}
      <path d="M8 30 L10.5 22 L13 30 L10.5 38 Z" fill={p.glow} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M52 33 L54 27 L56 33 L54 40 Z" fill={p.ice} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
      {/* The snowflake below. Three crossed bars with tick-marks — the thing on this card a
          player recognises before they have read anything. */}
      <g stroke={p.glow} strokeWidth="3" strokeLinecap="round">
        <line x1="32" y1="38" x2="32" y2="56" />
        <line x1="24" y1="42" x2="40" y2="52" />
        <line x1="40" y1="42" x2="24" y2="52" />
      </g>
      <g stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" opacity="0.7">
        <line x1="32" y1="38" x2="32" y2="56" />
        <line x1="24" y1="42" x2="40" y2="52" />
        <line x1="40" y1="42" x2="24" y2="52" />
      </g>
    </>
  );
}

/**
 * 昆蟲之翼. Four leaf-shaped panels drawn at low alpha, with veins over them.
 *
 * The problem this card shares with the frost halo is the same one and the answer is the same
 * kind: 星軌之翼's glyph is also "a pair of wings on a card". What separates them is that this
 * one is FOUR overlapping translucent shapes with lines drawn across them, and that one is a row
 * of separate opaque quills. Silhouette against fill — a difference that survives the thumbnail.
 */
function InsectWingsGlyph({ strokeColor, strokeWidth }: GlyphProps): ReactElement {
  const p = COSMETIC_PALETTE.butterfly;
  /** One wing: a long lens from the thorax outward. `s` is +1 left, -1 right. */
  const wing = (s: 1 | -1, fore: boolean) => {
    const tipX = 32 + s * (fore ? 27 : 19);
    const tipY = fore ? 16 : 46;
    const midY = fore ? 22 : 40;
    const bulge = fore ? 9 : 7;
    return (
      <>
        <path
          d={`M32 30 Q${32 + s * 12} ${midY - bulge} ${tipX} ${tipY} Q${32 + s * 14} ${midY + bulge} 32 30 Z`}
          fill={fore ? p.body : p.glow}
          opacity="0.62"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {/* Two veins. Drawn AFTER the panel and at the deep tint, so they read as markings on the
            membrane rather than as its edges. */}
        <path d={`M32 30 Q${32 + s * 13} ${midY - 2} ${tipX} ${tipY + (fore ? 3 : -3)}`} fill="none" stroke={p.deep} strokeWidth="1.6" opacity="0.8" />
        <path d={`M32 30 Q${32 + s * 12} ${midY + 3} ${32 + s * (fore ? 21 : 15)} ${fore ? 23 : 40}`} fill="none" stroke={p.deep} strokeWidth="1.3" opacity="0.65" />
      </>
    );
  };
  return (
    <>
      {wing(-1, false)}
      {wing(1, false)}
      {wing(-1, true)}
      {wing(1, true)}
      {/* The thorax, over the four roots so they all disappear into it. */}
      <rect x="28" y="18" width="8" height="26" rx="4" fill="#4a3f52" stroke={strokeColor} strokeWidth={strokeWidth} />
      <circle cx="32" cy="30" r="4.5" fill={p.glow} stroke={strokeColor} strokeWidth="1.6" />
      {/* Two loose motes, the 螢光 the item is sold on. */}
      <circle cx="15" cy="52" r="2.6" fill={p.glow} opacity="0.85" />
      <circle cx="50" cy="12" r="2.2" fill={p.glow} opacity="0.7" />
    </>
  );
}

const GLYPHS: Record<string, (props: GlyphProps) => ReactElement> = {
  starPin: StarPinGlyph,
  forestCrown: ForestCrownGlyph,
  bubblePin: BubblePinGlyph,
  flameCharm: FlameCharmGlyph,
  butterflyClip: ButterflyClipGlyph,
  starWings: StarWingsGlyph,
  spiritHalo: SpiritHaloGlyph,
  frostHalo: FrostHaloGlyph,
  insectWings: InsectWingsGlyph,
  oceanAnklet: OceanAnkletGlyph,
  bloomCircle: BloomCircleGlyph,
  rainCloud: RainCloudGlyph,
  tidePendant: TidePendantGlyph,
  musicBox: MusicBoxGlyph,
  petCloudPack: PetCloudPackGlyph,
  petShellCollar: PetShellCollarGlyph,
  petBellCollar: PetBellCollarGlyph,
  petBow: PetBowGlyph,
  petMushroom: PetMushroomGlyph,
  petBeehive: PetBeehiveGlyph,
  petStarCollar: PetStarCollarGlyph,
  petFlowerCollar: PetFlowerCollarGlyph,
};

/** True for any id this file can draw — the prefix test QVersionIcon dispatches on. */
export function isSpecialCosmeticIcon(itemId: string): boolean {
  const def = getSpecialCosmetic(itemId);
  return !!def && !!GLYPHS[def.model];
}

export function SpecialCosmeticIcon({
  itemId, size, className, strokeColor, strokeWidth,
}: {
  itemId: string;
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}): ReactElement | null {
  const def = getSpecialCosmetic(itemId);
  const Glyph = def && GLYPHS[def.model];
  if (!Glyph) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <Glyph strokeColor={strokeColor} strokeWidth={strokeWidth} />
    </svg>
  );
}
