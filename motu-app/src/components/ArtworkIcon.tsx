/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArtMotif, ArtPalette, ArtworkSpec, getArtworkSpec } from '../constants/artwork';

/**
 * The shop/inventory icon for an artwork, drawn from the same catalog row as the 3D piece.
 *
 * QVersionIcon.tsx is ~4,900 lines of hand-drawn SVG, one case per item, and that is the right
 * shape for a catalog of individually-designed objects. It is the wrong shape for artwork: forty
 * pieces built from a shared set of forms would be forty near-identical SVGs, and the first time
 * one of them fell out of step with its 3D model — a blue vase whose icon is still cream — nobody
 * would notice until a player did.
 *
 * So the icon is generated from `form` + `variant` + `motif` + `palette`, exactly like
 * Three/ArtworkModels.tsx generates the object. They cannot disagree, because there is only one
 * description of the piece and both of them read it. This is the arrangement 特殊飾品 and House
 * Styles already use in QVersionIcon (`SpecialCosmeticIcon`), and the reason a new artwork can
 * never fall through to the grey placeholder box.
 *
 * Drawn on the shared 64x64 viewBox with the same warm outline every other icon uses, so an
 * artwork card sits in a grid of hand-drawn ones without looking generated.
 */

export interface ArtworkIconProps {
  itemId: string;
  size?: number;
  className?: string;
  strokeColor: string;
  strokeWidth: string;
}

/** Does this id belong to an artwork? The gate QVersionIcon checks before delegating here. */
export function isArtworkIcon(itemId: string): boolean {
  return !!getArtworkSpec(itemId);
}

const FRAME = '#6b5745';
const GROUND = '#f6f1e4';

function colours(palette: ArtPalette) {
  return {
    frame: palette.frame ?? FRAME,
    ground: palette.ground ?? GROUND,
    a: palette.a ?? '#e07a5f',
    b: palette.b ?? '#3d5a80',
    c: palette.c ?? '#f2cc8f',
  };
}

/**
 * The picture inside a frame, at 2/3 icon scale — two or three shapes, same reading as the 3D
 * motif but simplified for 40 pixels.
 */
function MotifGlyph({ motif, palette, x, y, w, h }: {
  motif: ArtMotif | undefined; palette: ArtPalette; x: number; y: number; w: number; h: number;
}) {
  if (!motif) return null;
  const p = colours(palette);
  const cx = x + w / 2;
  const cy = y + h / 2;

  switch (motif) {
    case 'island':
      return (
        <>
          <rect x={x} y={y + h * 0.6} width={w} height={h * 0.4} fill={p.b} />
          <circle cx={x + w * 0.74} cy={y + h * 0.28} r={h * 0.15} fill={p.c} />
          <path d={`M${x + w * 0.1} ${y + h * 0.68} L${x + w * 0.42} ${y + h * 0.24} L${x + w * 0.72} ${y + h * 0.68} Z`} fill={p.a} />
        </>
      );
    case 'ocean':
      return (
        <>
          <rect x={x} y={y} width={w} height={h * 0.34} fill={p.a} />
          <rect x={x} y={y + h * 0.34} width={w} height={h * 0.33} fill={p.b} />
          <rect x={x} y={y + h * 0.67} width={w} height={h * 0.33} fill={p.a} />
        </>
      );
    case 'plant':
      return (
        <>
          <rect x={cx - w * 0.16} y={y + h * 0.68} width={w * 0.32} height={h * 0.3} rx={2} fill={p.c} />
          <path d={`M${cx} ${y + h * 0.7} L${cx} ${y + h * 0.22}`} stroke={p.b} strokeWidth={2} strokeLinecap="round" />
          <circle cx={cx - w * 0.2} cy={y + h * 0.4} r={h * 0.15} fill={p.a} />
          <circle cx={cx + w * 0.2} cy={y + h * 0.28} r={h * 0.13} fill={p.b} />
        </>
      );
    case 'abstract':
      return (
        <>
          <rect x={x + w * 0.08} y={y + h * 0.16} width={w * 0.4} height={h * 0.62} fill={p.a} />
          <circle cx={x + w * 0.68} cy={y + h * 0.52} r={h * 0.24} fill={p.b} />
        </>
      );
    case 'animal':
      return (
        <>
          <rect x={x} y={y} width={w} height={h * 0.42} fill={p.b} />
          <ellipse cx={cx - w * 0.06} cy={y + h * 0.62} rx={w * 0.3} ry={h * 0.22} fill={p.a} />
          <path d={`M${cx + w * 0.2} ${y + h * 0.62} L${x + w * 0.96} ${y + h * 0.44} L${x + w * 0.96} ${y + h * 0.8} Z`} fill={p.a} />
        </>
      );
    case 'portrait':
      return (
        <>
          <rect x={x + w * 0.12} y={y + h * 0.62} width={w * 0.76} height={h * 0.38} rx={3} fill={p.b} />
          <circle cx={cx} cy={y + h * 0.42} r={h * 0.2} fill={p.a} />
        </>
      );
    case 'landscape':
      return (
        <>
          <rect x={x} y={y + h * 0.7} width={w} height={h * 0.3} fill={p.b} />
          <path d={`M${x} ${y + h * 0.74} L${x + w * 0.36} ${y + h * 0.2} L${x + w * 0.68} ${y + h * 0.74} Z`} fill={p.a} />
          <path d={`M${x + w * 0.42} ${y + h * 0.74} L${x + w * 0.72} ${y + h * 0.36} L${w + x} ${y + h * 0.74} Z`} fill={p.b} />
          <circle cx={x + w * 0.76} cy={y + h * 0.22} r={h * 0.11} fill={p.c} />
        </>
      );
    // Same island map as the 3D motif, at 40 pixels: water, a coastline, a dashed route and the
    // cross. Kept in step with ArtworkModels' `illustration` case — the icon and the thing on the
    // wall are two drawings of one picture, and a player who cannot tell them apart is the point.
    case 'illustration':
      return (
        <>
          <rect x={x + w * 0.06} y={y + h * 0.1} width={w * 0.88} height={h * 0.8} rx={2} fill={p.b} />
          <circle cx={x + w * 0.36} cy={y + h * 0.58} r={h * 0.3} fill={p.ground} />
          <circle cx={x + w * 0.36} cy={y + h * 0.58} r={h * 0.24} fill={p.a} />
          <circle cx={x + w * 0.76} cy={y + h * 0.3} r={h * 0.16} fill={p.ground} />
          <circle cx={x + w * 0.76} cy={y + h * 0.3} r={h * 0.11} fill={p.a} />
          <path
            d={`M${x + w * 0.46} ${y + h * 0.52} L${x + w * 0.68} ${y + h * 0.36}`}
            stroke={p.c} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="3 2.5" fill="none"
          />
          <path
            d={`M${x + w * 0.72} ${y + h * 0.26} l${w * 0.08} ${h * 0.08} M${x + w * 0.8} ${y + h * 0.26} l${-w * 0.08} ${h * 0.08}`}
            stroke={p.c} strokeWidth={2} strokeLinecap="round" fill="none"
          />
        </>
      );
    case 'still':
      return (
        <>
          <rect x={x} y={y + h * 0.72} width={w} height={h * 0.28} fill={p.c} />
          <path d={`M${cx - w * 0.2} ${y + h * 0.74} Q${cx - w * 0.3} ${y + h * 0.36} ${cx - w * 0.05} ${y + h * 0.32} Q${cx + w * 0.16} ${y + h * 0.38} ${cx + w * 0.06} ${y + h * 0.74} Z`} fill={p.a} />
          <circle cx={x + w * 0.8} cy={y + h * 0.64} r={h * 0.12} fill={p.b} />
        </>
      );
    case 'sunset':
    default:
      return (
        <>
          <circle cx={cx} cy={y + h * 0.42} r={h * 0.26} fill={p.a} />
          <rect x={x} y={y + h * 0.64} width={w} height={h * 0.09} fill={p.b} />
          <rect x={x} y={y + h * 0.8} width={w} height={h * 0.09} fill={p.c} />
        </>
      );
  }
}

/** A framed picture: moulding, picture, motif. Shared by `framed`, `oil` and `gallery`. */
function FramedGlyph({ spec, x, y, w, h, bar, stroke, sw }: {
  spec: ArtworkSpec; x: number; y: number; w: number; h: number; bar: number;
  stroke: string; sw: string;
}) {
  const p = colours(spec.palette);
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={p.frame} stroke={stroke} strokeWidth={sw} />
      <rect x={x + bar} y={y + bar} width={w - bar * 2} height={h - bar * 2} fill={p.ground} stroke={stroke} strokeWidth="1.5" />
      <MotifGlyph motif={spec.motif} palette={spec.palette} x={x + bar} y={y + bar} w={w - bar * 2} h={h - bar * 2} />
      <rect x={x + bar} y={y + bar} width={w - bar * 2} height={h - bar * 2} fill="none" stroke={stroke} strokeWidth="1.5" />
    </>
  );
}

function ArtworkGlyph({ spec, stroke, sw }: { spec: ArtworkSpec; stroke: string; sw: string }) {
  const p = colours(spec.palette);
  const [sw0, sh0] = spec.size ?? [1.4, 1.1];
  // Fit the piece's own aspect into the icon's 44px picture area, so a portrait canvas reads as
  // portrait and a wide relief reads as wide — the silhouette is half of what makes a card
  // recognisable at this size.
  const aspect = sw0 / sh0;
  const boxW = aspect >= 1 ? 44 : 44 * aspect;
  const boxH = aspect >= 1 ? 44 / aspect : 44;
  const bx = 32 - boxW / 2;
  const by = 32 - boxH / 2;

  switch (spec.form) {
    case 'framed':
      return <FramedGlyph spec={spec} x={bx} y={by} w={boxW} h={boxH} bar={5} stroke={stroke} sw={sw} />;

    case 'oil':
      return (
        <>
          <FramedGlyph spec={spec} x={bx} y={by} w={boxW} h={boxH} bar={8} stroke={stroke} sw={sw} />
          <rect x={bx + 4} y={by + 4} width={boxW - 8} height={boxH - 8} fill="none" stroke="#e8d9b8" strokeWidth="2" />
        </>
      );

    case 'canvas':
      return (
        <>
          <rect x={bx} y={by} width={boxW} height={boxH} rx={2} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          <MotifGlyph motif={spec.motif} palette={spec.palette} x={bx} y={by} w={boxW} h={boxH} />
          <rect x={bx} y={by} width={boxW} height={boxH} rx={2} fill="none" stroke={stroke} strokeWidth={sw} />
          {/* Wrapped edge, which is the whole point of a gallery-wrap canvas. */}
          <path d={`M${bx + boxW} ${by + 3} l4 3 v${boxH - 6} l-4 3`} fill="#d9c8ac" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
        </>
      );

    case 'poster':
      return (
        <>
          <rect x={bx} y={by} width={boxW} height={boxH} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          <MotifGlyph motif={spec.motif} palette={spec.palette} x={bx} y={by} w={boxW} h={boxH} />
          <rect x={bx} y={by} width={boxW} height={boxH} fill="none" stroke={stroke} strokeWidth={sw} />
          {[[bx + 4, by + 4], [bx + boxW - 4, by + 4], [bx + 4, by + boxH - 4], [bx + boxW - 4, by + boxH - 4]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={2.2} fill={p.a} stroke={stroke} strokeWidth="1.2" />
          ))}
        </>
      );

    case 'tapestry':
      return (
        <>
          <rect x={bx - 4} y={by} width={boxW + 8} height={4} rx={2} fill={p.frame} stroke={stroke} strokeWidth="1.5" />
          <rect x={bx} y={by + 6} width={boxW} height={boxH - 14} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          <MotifGlyph motif={spec.motif} palette={spec.palette} x={bx} y={by + 6} w={boxW} h={boxH - 14} />
          <rect x={bx} y={by + 6} width={boxW} height={boxH - 14} fill="none" stroke={stroke} strokeWidth={sw} />
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${bx + 4 + i * ((boxW - 8) / 4)} ${by + boxH - 8} v${5 + (i % 2) * 3}`}
              stroke={p.b} strokeWidth="2.2" strokeLinecap="round"
            />
          ))}
        </>
      );

    case 'macrame': {
      const feather = spec.variant === 'feather';
      return (
        <>
          <rect x={bx - 3} y={by + 2} width={boxW + 6} height={4} rx={2} fill={p.frame} stroke={stroke} strokeWidth="1.5" />
          {[0, 1, 2, 3].map((i) => {
            const cx = bx + 5 + i * ((boxW - 10) / 3);
            const len = feather ? 20 + (i % 2) * 8 : 26;
            if (!feather) {
              return <path key={i} d={`M${cx} ${by + 6} v${len}`} stroke={p.a} strokeWidth="3" strokeLinecap="round" />;
            }
            // The plume's real outline — narrow at the tie, widest a third down, ending in a
            // point — plus its quill, matching the 3D model rather than the old flat ellipse.
            const top = by + 8;
            const shoulder = top + len * 0.38;
            const tip = top + len;
            return (
              <g key={i}>
                <path
                  d={`M${cx} ${top} Q${cx + 5} ${shoulder} ${cx} ${tip} Q${cx - 5} ${shoulder} ${cx} ${top} Z`}
                  fill={p.a} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round"
                />
                <path d={`M${cx} ${top + 1} L${cx} ${tip - 1}`} stroke={p.c} strokeWidth="1.6" strokeLinecap="round" />
              </g>
            );
          })}
          {/* The tassel the piece is half-named after: a bound bundle of cut cord at the centre. */}
          {feather && (
            <>
              <rect x={bx + boxW / 2 - 3} y={by + 12} width={6} height={4} rx={1.5} fill={p.c} />
              {[-2.5, 0, 2.5].map((dx, i) => (
                <path key={i} d={`M${bx + boxW / 2 + dx} ${by + 16} v${9 + (i % 2) * 4}`} stroke={p.b} strokeWidth="1.6" strokeLinecap="round" />
              ))}
            </>
          )}
          {!feather && (
            <>
              <path d={`M${bx + 4} ${by + 18} L${bx + boxW - 4} ${by + 24}`} stroke={p.b} strokeWidth="2.5" strokeLinecap="round" />
              <path d={`M${bx + 4} ${by + 26} L${bx + boxW - 4} ${by + 20}`} stroke={p.b} strokeWidth="2.5" strokeLinecap="round" />
            </>
          )}
        </>
      );
    }

    case 'relief':
      return (
        <>
          <rect x={bx} y={by} width={boxW} height={boxH} rx={2} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          {spec.variant === 'driftwood'
            ? [0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={bx + 4 + i * ((boxW - 8) / 4)} y={by + 3 + (i % 2) * 3}
                width={(boxW - 12) / 4} height={boxH - 8 - (i % 2) * 6}
                rx={2.5} fill={i % 2 ? p.ground : p.a} stroke={stroke} strokeWidth="1.5"
              />
            ))
            : [0, 1, 2].map((i) => (
              <rect
                key={i}
                x={bx + 4} y={by + 4 + i * ((boxH - 8) / 3)}
                width={boxW - 8} height={(boxH - 12) / 3}
                rx={2} fill={i === 1 ? p.a : p.ground} stroke={stroke} strokeWidth="1.5"
              />
            ))}
        </>
      );

    case 'gallery': {
      const grid = spec.variant === 'grid';
      const cols = 3;
      const rows = grid ? 2 : 1;
      const cw = (boxW - 4 * (cols - 1)) / cols;
      const ch = grid ? (boxH - 4) / 2 : boxH * 0.7;
      return (
        <>
          {Array.from({ length: cols * rows }).map((_, i) => {
            if (grid && i === cols * rows - 1) return null;
            const col = i % cols;
            const row = Math.floor(i / cols);
            return (
              <FramedGlyph
                key={i}
                spec={spec}
                x={bx + col * (cw + 4)}
                y={(grid ? by : 32 - ch / 2) + row * (ch + 4)}
                w={cw} h={ch} bar={3} stroke={stroke} sw="1.5"
              />
            );
          })}
        </>
      );
    }

    case 'charm':
      return (
        <>
          <circle cx={32} cy={10} r={3} fill={p.frame} stroke={stroke} strokeWidth="1.5" />
          <path d="M32 12 v34" stroke={p.ground} strokeWidth="2" />
          {spec.variant === 'geometric' ? (
            <>
              <circle cx={32} cy={22} r={6} fill={p.a} stroke={stroke} strokeWidth={sw} />
              <path d="M32 30 l7 12 h-14 Z" fill={p.b} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
              <rect x={26} y={44} width={12} height={12} rx={2} fill={p.a} stroke={stroke} strokeWidth={sw} />
            </>
          ) : (
            [0, 1, 2].map((i) => (
              <ellipse key={i} cx={32} cy={20 + i * 13} rx={9 - i} ry={5} fill={i === 1 ? p.b : p.a} stroke={stroke} strokeWidth={sw} />
            ))
          )}
        </>
      );

    case 'figurine':
      return (
        <>
          <ellipse cx={32} cy={52} rx={16} ry={5} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          {spec.variant === 'bird' ? (
            <>
              <ellipse cx={32} cy={36} rx={9} ry={14} fill={p.ground} stroke={stroke} strokeWidth={sw} />
              <circle cx={32} cy={19} r={7} fill={p.ground} stroke={stroke} strokeWidth={sw} />
              <path d="M39 18 l7 3 l-7 3 Z" fill={p.a} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx={30} cy={18} r={1.6} fill={stroke} />
            </>
          ) : (
            <>
              <ellipse cx={32} cy={40} rx={17} ry={10} fill={p.ground} stroke={stroke} strokeWidth={sw} />
              <circle cx={38} cy={29} r={9} fill={p.ground} stroke={stroke} strokeWidth={sw} />
              <path d="M32 22 l3 -6 l5 4 Z" fill={p.a} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M43 21 l5 -5 l3 6 Z" fill={p.a} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx={35} cy={29} r={1.6} fill={stroke} />
              <circle cx={42} cy={29} r={1.6} fill={stroke} />
            </>
          )}
        </>
      );

    case 'vessel':
      return (
        <>
          <path d="M22 22 h20 l-3 8 a14 14 0 1 1 -14 0 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M20 34 a5 5 0 0 0 3 -9" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M44 34 a5 5 0 0 1 -3 -9" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
          <rect x={21} y={19} width={22} height={5} rx={2.5} fill={p.b} stroke={stroke} strokeWidth="1.8" />
        </>
      );

    case 'vase':
    case 'floorvase':
      return (
        <>
          <path d={`M${28} ${24} h8 l3 ${spec.form === 'floorvase' ? 30 : 24} h-14 Z`} fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M32 24 v-12" stroke={p.b} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M32 18 l-7 -6" stroke={p.b} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M32 20 l7 -7" stroke={p.b} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx={25} cy={11} r={4} fill={p.c} stroke={stroke} strokeWidth="1.5" />
          <circle cx={40} cy={12} r={3.4} fill={p.a} stroke={stroke} strokeWidth="1.5" />
        </>
      );

    case 'objet':
      return (
        <>
          <rect x={16} y={48} width={32} height={7} rx={2.5} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          {spec.variant === 'loop' ? (
            <ellipse cx={32} cy={30} rx={15} ry={16} fill="none" stroke={p.ground} strokeWidth="8" transform="rotate(24 32 30)" />
          ) : (
            <path d="M18 48 v-14 a14 14 0 0 1 28 0 v14 h-8 v-14 a6 6 0 0 0 -12 0 v14 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          )}
          {spec.variant === 'loop' && (
            <ellipse cx={32} cy={30} rx={15} ry={16} fill="none" stroke={stroke} strokeWidth="1.6" transform="rotate(24 32 30)" />
          )}
        </>
      );

    case 'plate':
      return (
        <>
          <rect x={22} y={50} width={20} height={5} rx={2.5} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          <circle cx={32} cy={30} r={20} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          {spec.motif === 'sunset'
            ? [0, 1, 2, 3, 4, 5].map((i) => (
              <path key={i} d={`M32 30 L${32 + 16 * Math.cos((i * Math.PI) / 3)} ${30 + 16 * Math.sin((i * Math.PI) / 3)}`} stroke={p.a} strokeWidth="3.5" strokeLinecap="round" />
            ))
            : (
              <>
                <circle cx={32} cy={30} r={12} fill="none" stroke={p.b} strokeWidth="3" />
                <circle cx={32} cy={30} r={4.5} fill={p.a} />
              </>
            )}
          <circle cx={32} cy={30} r={20} fill="none" stroke={p.a} strokeWidth="2.5" />
        </>
      );

    case 'crystal':
      return (
        <>
          <path d="M16 52 q6 -10 16 -10 q10 0 16 10 Z" fill={p.frame} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          {spec.variant === 'point' ? (
            <path d="M32 8 l8 12 v24 h-16 v-24 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          ) : (
            <>
              <path d="M22 44 l4 -20 l6 20 Z" fill={p.b} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
              <path d="M30 44 l5 -28 l7 28 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
              <path d="M40 44 l5 -14 l4 14 Z" fill={p.a} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
            </>
          )}
        </>
      );

    case 'craft':
      return spec.variant === 'boat' ? (
        <>
          <path d="M12 40 h40 l-7 12 h-26 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M30 38 v-26" stroke={p.frame} strokeWidth="3" strokeLinecap="round" />
          <path d="M32 14 l14 12 l-14 6 Z" fill={p.a} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M28 20 l-10 12 h10 Z" fill={p.b} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M18 26 h28 l-4 26 h-20 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M19 34 h26" stroke={p.a} strokeWidth="2.6" />
          <path d="M20 42 h24" stroke={p.b} strokeWidth="2.6" />
          <path d="M20 24 a12 10 0 0 1 24 0" fill="none" stroke={p.frame} strokeWidth="3" strokeLinecap="round" />
          <rect x={16} y={23} width={32} height={5} rx={2.5} fill={p.frame} stroke={stroke} strokeWidth="1.5" />
        </>
      );

    case 'statue':
      return spec.variant === 'totem' ? (
        <>
          <rect x={18} y={52} width={28} height={6} rx={2} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={21 + i} y={16 + i * 12} width={22 - i * 2} height={12} rx={2} fill={i === 1 ? p.a : p.ground} stroke={stroke} strokeWidth={sw} />
          ))}
          <path d="M32 16 l7 -8 h-14 Z" fill={p.b} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <rect x={16} y={50} width={32} height={8} rx={2} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          <rect x={20} y={45} width={24} height={6} rx={1.5} fill={p.a} stroke={stroke} strokeWidth="1.5" />
          {spec.variant === 'figure' ? (
            <path d="M26 45 v-20 a6 6 0 0 1 12 0 v20 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          ) : (
            <rect x={22} y={22} width={20} height={24} rx={2} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          )}
          <ellipse cx={32} cy={15} rx={8} ry={9} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          <path d="M28 15 h3 M36 15 h-3" stroke={p.a} strokeWidth="2.5" strokeLinecap="round" />
        </>
      );

    case 'urn':
      return (
        <>
          <path d="M24 18 h16 l-2 6 a18 16 0 1 1 -12 0 Z" fill={p.ground} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M15 36 h34" stroke={p.a} strokeWidth="3" />
          <rect x={23} y={14} width={18} height={5} rx={2.5} fill={p.b} stroke={stroke} strokeWidth="1.8" />
        </>
      );

    case 'plinth':
      return (
        <>
          <rect x={22} y={26} width={20} height={30} rx={2} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          <rect x={19} y={23} width={26} height={5} rx={2} fill={p.frame} stroke={stroke} strokeWidth={sw} />
          {spec.variant === 'sphere' ? (
            <circle cx={32} cy={14} r={10} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          ) : (
            <>
              <rect x={28} y={5} width={8} height={19} rx={2} fill={p.ground} stroke={stroke} strokeWidth={sw} transform="rotate(16 32 14)" />
              <rect x={36} y={10} width={6} height={13} rx={2} fill={p.a} stroke={stroke} strokeWidth="1.6" transform="rotate(-22 39 17)" />
            </>
          )}
        </>
      );

    case 'installation':
      return spec.variant === 'mobile' ? (
        <>
          <ellipse cx={32} cy={54} rx={14} ry={5} fill={p.ground} stroke={stroke} strokeWidth={sw} />
          <path d="M32 52 v-44" stroke={p.frame} strokeWidth="3.5" strokeLinecap="round" />
          {[[18, 44, p.a], [46, 30, p.b], [18, 18, p.b]].map(([x, y, fill], i) => (
            <g key={i}>
              <path d={`M32 ${y} H${x}`} stroke={p.frame} strokeWidth="2" />
              <ellipse cx={Number(x)} cy={Number(y)} rx={7} ry={4} fill={String(fill)} stroke={stroke} strokeWidth="1.6" transform={`rotate(${i % 2 ? 20 : -20} ${x} ${y})`} />
            </g>
          ))}
        </>
      ) : (
        <>
          <path d="M14 54 v-22 a18 18 0 0 1 36 0 v22 h-9 v-22 a9 9 0 0 0 -18 0 v22 Z" fill={p.frame} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <rect x={27} y={11} width={10} height={7} rx={2} fill={p.a} stroke={stroke} strokeWidth="1.6" />
        </>
      );
  }
}

export function ArtworkIcon({ itemId, size = 32, className = '', strokeColor, strokeWidth }: ArtworkIconProps) {
  const spec = getArtworkSpec(itemId);
  if (!spec) return null;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <ArtworkGlyph spec={spec} stroke={strokeColor} sw={strokeWidth} />
    </svg>
  );
}
