import React from 'react';
import { motion } from 'motion/react';
import {
  Shirt, Shell, Palmtree,
  Anchor, Flower2, Waves, Droplets
} from 'lucide-react';
import { getHouseStyleByItemId, HouseStyleDefinition } from '../constants/houseStyles';
import { getHairSpec } from '../constants/hair';
import { getHatPalette } from '../constants/hats';
import { PANTS_PALETTES, DENIM_RIVET, DENIM_TURNUP } from '../constants/pants';
import { isSpecialCosmeticIcon, SpecialCosmeticIcon } from './SpecialCosmeticIcon';
import { ArtworkIcon, isArtworkIcon } from './ArtworkIcon';
import { PET_SPECS, PetSpec } from '../constants/pets';
import { HIPPO, RABBIT } from '../constants/npcs';
// 抽獎券的圖示認的是目錄裡的 grantsTickets 欄位，不是一個寫死的 id —— 見下面 RaffleTicketIcon。
import { getItemById } from '../constants/items';

/**
 * Flat-art shading derived from one product colour.
 *
 * Shared by the hair and hat thumbnails so neither authors a highlight by hand: an
 * item declares the colour it actually is in 3D, and its readable tints follow. A
 * near-white product has to shade DOWN (a lighter highlight on #e2e8f0 is invisible)
 * and a dark one UP, which is why this keys off luminance rather than being a fixed
 * pair of tints - 黑長直 and 毛帽's white pompom would otherwise need opposite rules.
 */
function shadeFrom(color: string) {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const mix = (amount: number) => {
    const target = luminance > 0.6 ? 0 : 255;
    return `#${rgb.map(c => Math.round(c + (target - c) * amount).toString(16).padStart(2, '0')).join('')}`;
  };
  return {
    mix,
    /** Top stop of the body gradient. */
    top: mix(0.28),
    /** Primary highlight - gloss, straw lights, knit sheen. */
    shine: mix(0.55),
    /** Secondary lines - stitching, strands. */
    shineSoft: mix(0.3),
    /** Shadowed face, for giving a flat shape thickness. */
    deep: luminance > 0.6 ? mix(0.22) : `#${rgb.map(c => Math.round(c * 0.62).toString(16).padStart(2, '0')).join('')}`,
  };
}

interface QVersionIconProps {
  itemId?: string;
  categoryId?: string;
  size?: number;
  className?: string;
}

/**
 * Shop/inventory icon for a House Style, built from the same palette and roof silhouette the 3D
 * HouseModel uses. Data-driven on purpose: this file is otherwise a ~100-case exact-id switch,
 * so a new style would silently render the grey fallback box without it.
 */
function HouseStyleIcon({
  style, size, className, strokeColor, strokeWidth,
}: {
  style: HouseStyleDefinition;
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  const c = style.palette;
  const f = style.features ?? {};

  // Roof silhouette per RoofKind, matching HouseModel's shapes.
  const roof = (() => {
    switch (style.roof) {
      case 'thatch':
        return (
          <>
            <path d="M8 34L32 14L56 34H8Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M14 24L32 8L50 24H14Z" fill={c.roofAccent} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M30 8L32 3L34 8H30Z" fill={c.roof} />
          </>
        );
      case 'slab':
        return (
          <>
            <rect x="6" y="26" width="52" height="7" rx="1.5" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} />
            <rect x="12" y="19" width="40" height="8" rx="1.5" fill={c.roofAccent} stroke={strokeColor} strokeWidth={strokeWidth} />
          </>
        );
      case 'hip':
        return (
          <>
            <rect x="5" y="30" width="54" height="4" rx="1.5" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1.5" />
            <path d="M10 30L32 13L54 30H10Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          </>
        );
      case 'gambrel':
        // Barn profile: a steep lower pitch breaking into a shallow upper one. The knuckle is the
        // whole point of the shape, so it is drawn as a visible corner rather than smoothed.
        return (
          <>
            <path d="M6 32L15 21L32 13L49 21L58 32H6Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M15 21L49 21" stroke={c.roofAccent} strokeWidth="1.6" />
            <line x1="32" y1="13" x2="32" y2="32" stroke={c.roofAccent} strokeWidth="2" />
          </>
        );
      case 'cottage':
        // A hip, plus the little cross-gable that projects over the door — the one feature that
        // separates 花園小屋 from 海景小屋 at a glance, in the icon as much as in the world.
        return (
          <>
            <rect x="5" y="30" width="54" height="4" rx="1.5" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1.5" />
            <path d="M10 30L32 14L54 30H10Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M23 33L32 20L41 33H23Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M23 33L32 20L41 33" fill="none" stroke={c.roofAccent} strokeWidth="1.6" strokeLinejoin="round" />
          </>
        );
      case 'pavilion':
        // TWO tiers with daylight between them. The gap is the whole recognition — a single
        // pyramid here would be the `hip` icon in another colour, which is exactly the confusion
        // the model avoids by building this roof in two pieces.
        return (
          <>
            <rect x="2" y="29" width="60" height="4" rx="1.5" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1.5" />
            <path d="M5 29L32 16L59 29H5Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* the ventilation gap, and the posts holding the cap clear of the skirt */}
            <line x1="14" y1="16" x2="14" y2="12" stroke={c.trim} strokeWidth="1.6" />
            <line x1="50" y1="16" x2="50" y2="12" stroke={c.trim} strokeWidth="1.6" />
            <rect x="11" y="10" width="42" height="3" rx="1" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1.2" />
            <path d="M13 10L32 1L51 10H13Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          </>
        );
      case 'dormer':
        // A steeper pitch than `gable`, with the dormer pushed out of its front slope.
        return (
          <>
            <path d="M8 32L32 7L56 32H8Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <line x1="32" y1="7" x2="32" y2="32" stroke={c.roofAccent} strokeWidth="2" />
            <path d="M20 32L27 21L34 32H20Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <rect x="24" y="26" width="6" height="6" rx="1" fill={c.glass} stroke={c.frame} strokeWidth="1.2" />
          </>
        );
      case 'flat':
        // No pitch at all — a cantilevered band, a parapet, and the terrace railing. The railing
        // is the part that says "you can stand up there", which is what separates it from `slab`.
        return (
          <>
            <rect x="3" y="27" width="58" height="6" rx="1.5" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} />
            <rect x="10" y="22" width="44" height="5" rx="1" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1.2" />
            <line x1="12" y1="22" x2="12" y2="14" stroke={c.trim} strokeWidth="2" strokeLinecap="round" />
            <line x1="32" y1="22" x2="32" y2="14" stroke={c.trim} strokeWidth="2" strokeLinecap="round" />
            <line x1="52" y1="22" x2="52" y2="14" stroke={c.trim} strokeWidth="2" strokeLinecap="round" />
            <line x1="11" y1="14.5" x2="53" y2="14.5" stroke={c.trim} strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case 'saltbox':
        // Lopsided on purpose: short steep slope on the right, long shallow one sweeping left and
        // ending BELOW the other eave. Every other roof in this switch is symmetric about x = 32.
        return (
          <>
            <path d="M2 36L40 12L60 30H2Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M40 12L60 30" fill="none" stroke={c.roofAccent} strokeWidth="2" />
            <line x1="14" y1="29" x2="26" y2="21" stroke={c.roofAccent} strokeWidth="1.6" strokeLinecap="round" />
          </>
        );
      case 'gablefront':
        // The gable TRIANGLE facing you, over a narrow front — a ridge line straight down the
        // middle would be wrong here, because the ridge runs away from the viewer.
        return (
          <>
            <rect x="6" y="30" width="52" height="4" rx="1.5" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1.5" />
            <path d="M9 30L32 6L55 30H9Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M15 27L32 10L49 27" fill="none" stroke={c.trim} strokeWidth="2" strokeLinejoin="round" />
            <circle cx="32" cy="21" r="2.6" fill={c.roofAccent} stroke={strokeColor} strokeWidth="1" />
          </>
        );
      default: // 'gable'
        return (
          <>
            <path d="M7 32L32 12L57 32H7Z" fill={c.roof} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <line x1="32" y1="12" x2="32" y2="32" stroke={c.roofAccent} strokeWidth="2.5" />
          </>
        );
    }
  })();

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Foundation plinth */}
      <rect x="10" y="46" width="44" height="4" rx="1" fill={c.plinth} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* Wall body */}
      <path d="M12 46V31H52V46H12Z" fill={c.wall} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />

      {/* Wall treatment */}
      {style.wall === 'timber' && (
        <>
          <line x1="14.5" y1="31" x2="14.5" y2="46" stroke={c.trim} strokeWidth="2.5" />
          <line x1="49.5" y1="31" x2="49.5" y2="46" stroke={c.trim} strokeWidth="2.5" />
        </>
      )}
      {style.wall === 'masonry' && (
        <>
          <rect x="11" y="35" width="4" height="6" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
          <rect x="49" y="35" width="4" height="6" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
          <line x1="12" y1="38" x2="52" y2="38" stroke={c.trim} strokeWidth="1.5" />
          <line x1="12" y1="43" x2="52" y2="43" stroke={c.trim} strokeWidth="1.5" />
        </>
      )}
      {style.wall === 'plank' && (
        <>
          <line x1="12" y1="36" x2="52" y2="36" stroke={c.trim} strokeWidth="1.5" />
          <line x1="12" y1="41" x2="52" y2="41" stroke={c.trim} strokeWidth="1.5" />
        </>
      )}
      {/* Vertical poles with two lashing bands. Round caps, because what says "bamboo" rather than
          "fence" is the cylinder — the same read the model buys with 6-sided cylinders. */}
      {style.wall === 'bamboo' && (
        <>
          {[14.5, 19, 23.5, 28, 36, 40.5, 45, 49.5].map((x) => (
            <line key={x} x1={x} y1="31" x2={x} y2="46" stroke={c.trim} strokeWidth="2.8" strokeLinecap="round" />
          ))}
          <line x1="12" y1="35" x2="52" y2="35" stroke={c.frame} strokeWidth="2" />
          <line x1="12" y1="44" x2="52" y2="44" stroke={c.frame} strokeWidth="2" />
        </>
      )}
      {/* Board-and-batten: the seams run UP, which is the one thing that has to survive being
          shrunk to 64px — it is the whole difference from `plank`. */}
      {style.wall === 'batten' && (
        <>
          {[16, 21, 26, 38, 43, 48].map((x) => (
            <line key={x} x1={x} y1="32" x2={x} y2="45" stroke={c.trim} strokeWidth="1.8" />
          ))}
          <rect x="11" y="44" width="42" height="2.5" fill={c.frame} />
        </>
      )}
      {/* Two reveal joints and one accent bay. Nothing else — a modern rendered wall is
          recognised by how LITTLE is drawn on it. */}
      {style.wall === 'panel' && (
        <>
          <line x1="24" y1="31" x2="24" y2="46" stroke={c.frame} strokeWidth="1.2" />
          <line x1="44" y1="31" x2="44" y2="46" stroke={c.frame} strokeWidth="1.2" />
          <rect x="12" y="31" width="6" height="15" fill={c.trim} />
          <rect x="12" y="44.5" width="40" height="1.6" fill={c.frame} />
        </>
      )}
      {/* Staggered shake courses. The offset between rows is the read; a grid would be tile. */}
      {style.wall === 'shingle' && (
        <>
          {[33.5, 37.5, 41.5, 45].map((y, row) => (
            <g key={y}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect
                  key={i}
                  x={12 + i * 6.7 + (row % 2) * 3.35}
                  y={y - 3.4}
                  width="6"
                  height="3.6"
                  rx="1.2"
                  fill={row % 2 === 0 ? c.trim : c.plinth}
                  stroke={strokeColor}
                  strokeWidth="0.7"
                />
              ))}
            </g>
          ))}
        </>
      )}
      {/* Round-capped courses that run PAST the wall on both sides — the notched corner that
          alternate log courses make, which is how the model reads a log cabin too. */}
      {style.wall === 'log' && (
        <>
          {[33.5, 37.5, 41.5, 45].map((y, i) => (
            <line
              key={y}
              x1={i % 2 === 0 ? 10 : 12}
              y1={y}
              x2={i % 2 === 0 ? 54 : 52}
              y2={y}
              stroke={i % 2 === 0 ? c.trim : c.plinth}
              strokeWidth="3.4"
              strokeLinecap="round"
            />
          ))}
        </>
      )}

      {roof}
      {f.chimney && <rect x="41" y="8" width="6" height="11" fill={c.trim} stroke={strokeColor} strokeWidth="1.2" />}

      {/* Side window */}
      <rect x="16" y="35" width="8" height="8" rx="1" fill={c.glass} stroke={c.frame} strokeWidth="1.5" />
      <line x1="20" y1="35" x2="20" y2="43" stroke={c.frame} strokeWidth="1" />
      <line x1="16" y1="39" x2="24" y2="39" stroke={c.frame} strokeWidth="1" />
      {f.windowFlowerBox && (
        <>
          <rect x="15" y="43" width="10" height="3" rx="1" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
          <circle cx="20" cy="42.5" r="1.6" fill="#F87171" />
        </>
      )}

      {/* Door */}
      <path d="M27 46V37C27 35.5 29 34.5 32 34.5C35 34.5 37 35.5 37 37V46H27Z" fill={c.door} stroke={c.frame} strokeWidth={strokeWidth} />
      <circle cx="34.8" cy="41" r="1.2" fill="#D4A017" />

      {f.doorPlanter && (
        <>
          <path d="M42 42h5v4h-5z" fill="#E7DCCA" stroke={strokeColor} strokeWidth="1.2" />
          <circle cx="44.5" cy="40" r="3" fill="#4D7C0F" />
        </>
      )}
      {f.firewood && (
        <>
          <circle cx="42.5" cy="44.5" r="1.8" fill={c.frame} stroke={strokeColor} strokeWidth="1" />
          <circle cx="46.5" cy="44.5" r="1.8" fill={c.frame} stroke={strokeColor} strokeWidth="1" />
        </>
      )}
      {f.fence && (
        <>
          <line x1="4" y1="47" x2="4" y2="53" stroke={c.trim} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="10" y1="47" x2="10" y2="53" stroke={c.trim} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="54" y1="47" x2="54" y2="53" stroke={c.trim} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="60" y1="47" x2="60" y2="53" stroke={c.trim} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {f.stilts && (
        <>
          <rect x="15" y="50" width="4" height="6" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
          <rect x="45" y="50" width="4" height="6" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
        </>
      )}
      {f.shutters && (
        <>
          <rect x="13" y="35" width="2.6" height="8" rx="0.8" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
          <rect x="24.4" y="35" width="2.6" height="8" rx="0.8" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
        </>
      )}
      {f.porch && (
        <>
          <rect x="24" y="33" width="16" height="2.6" rx="1" fill={c.roof} stroke={strokeColor} strokeWidth="1.2" />
          <line x1="25.2" y1="35.6" x2="25.2" y2="46" stroke={c.trim} strokeWidth="2" />
          <line x1="38.8" y1="35.6" x2="38.8" y2="46" stroke={c.trim} strokeWidth="2" />
        </>
      )}
      {f.lantern && (
        <>
          <line x1="40" y1="36" x2="43" y2="36" stroke={c.frame} strokeWidth="1.2" />
          <rect x="41.6" y="36" width="3.4" height="4" rx="0.8" fill={c.glass} stroke={c.frame} strokeWidth="1.2" />
        </>
      )}
      {f.barrel && (
        <>
          <rect x="6" y="39" width="5.5" height="7" rx="1.4" fill={c.frame} stroke={strokeColor} strokeWidth="1.2" />
          <line x1="6" y1="42.5" x2="11.5" y2="42.5" stroke={c.trim} strokeWidth="1.2" />
        </>
      )}
      {/* 小型陽台 — deck line, handrail and balusters, over the door where the model puts it. */}
      {f.balcony && (
        <>
          <rect x="25" y="32.5" width="14" height="2" rx="0.8" fill={c.trim} stroke={strokeColor} strokeWidth="1" />
          <line x1="25" y1="29" x2="39" y2="29" stroke={c.frame} strokeWidth="1.6" strokeLinecap="round" />
          {[26.5, 30, 33.5, 37].map((x) => (
            <line key={x} x1={x} y1="29" x2={x} y2="32.5" stroke={c.trim} strokeWidth="1.1" />
          ))}
        </>
      )}
      {/* 小型遮雨棚 over the side window. */}
      {f.awning && (
        <path d="M14 34.5h12l1.5 -3h-15Z" fill={c.roof} stroke={strokeColor} strokeWidth="1" strokeLinejoin="round" />
      )}
      {/* Floats on a line — the one place a house icon carries colours that are not its palette,
          because a float that matched the wall would not be a float. */}
      {f.floats && (
        <>
          <path d="M40 34 q5 3 10 0" fill="none" stroke={c.frame} strokeWidth="1.1" />
          <circle cx="42" cy="37" r="2.2" fill="#E8734A" stroke={strokeColor} strokeWidth="0.9" />
          <circle cx="46" cy="38.4" r="2.2" fill="#4A90A4" stroke={strokeColor} strokeWidth="0.9" />
          <circle cx="50" cy="37" r="2.2" fill="#E8C34A" stroke={strokeColor} strokeWidth="0.9" />
        </>
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   TROUSERS (下裝 / `pants-*`)
   ---------------------------------------------------------------------------
   Drawn front-on and flat, the way a pair is laid out on a table.

   TWO THINGS THIS FIXES, and they are related.

   1. The legs were two SEPARATE boxes with a gap down the middle and a bar
      balanced on top — a garment sliced in half. Trousers are one piece of
      cloth: the legs part at the crotch and are joined everywhere above it.
      So the silhouette here is a SINGLE closed path, and the split between the
      legs is a notch cut up into it, not a space between two shapes. Because
      the path is generated rather than hand-typed five times, the legs cannot
      come apart again — there is one outline and it has no gap in it.

   2. All five cuts shared that one shape and differed only by fill colour and
      a 2px width change, so 直筒 / 錐形 / 寬褲 / 窄管 / 工裝 were the same
      picture in five colours. What actually distinguishes these cuts is the
      SILHOUETTE — "tapered" literally means wide at the hip and narrow at the
      ankle — so that is what {@link TrouserShape} parameterises: half-widths
      measured at the waist, hip, knee and hem. Colour and trim (pockets,
      pleats, cuffs, drape folds) then sit on top of a shape that already reads,
      the same rule the shoe icons below follow. */

/** Y stations every cut shares, so a row of trousers in the shop grid lines up. */
const TROUSER_WAIST_Y = 14;
const TROUSER_HIP_Y = 25;
const TROUSER_CROTCH_Y = 31;
// The knee sits partway down the leg rather than at a fixed offset from the crotch, so lengthening
// the leg below stretches the thigh and the shin together instead of leaving a stumpy thigh over a
// long shin.
const TROUSER_KNEE_Y = 42.6;
// Long enough that the leg, not the waistband, is what the eye reads first. The hem is as low as
// the 64-box allows: below it there is only the ground shadow, whose own Y is derived from this
// one so the two move together.
const TROUSER_HEM_Y = 60;

/** Half-widths of the garment, measured out from the centre line at each station. */
interface TrouserShape {
  waistHalf: number;
  hipHalf: number;
  /** Outer/inner edge of one leg at the knee. Their difference is the leg's width there. */
  kneeOuter: number;
  kneeInner: number;
  hemOuter: number;
  hemInner: number;
}

/**
 * A run between two points that leaves BOTH of them vertically — the shape of a seam falling
 * under its own weight. Every segment of the outline is one, which is what keeps the silhouette
 * reading as cloth instead of as a polygon.
 */
function seam(x1: number, y1: number, x2: number, y2: number): string {
  const t = (y2 - y1) * 0.45;
  return `C${x1} ${y1 + t} ${x2} ${y2 - t} ${x2} ${y2}`;
}

/**
 * The whole garment as one closed path: down the left side, down the left leg's outer edge,
 * across its hem, back UP the inseam to the crotch, then mirrored down the right. The crotch is
 * the single point where the two inseams meet — above it the trousers are one body.
 */
function trouserOutline(s: TrouserShape): string {
  const L = (v: number) => 32 - v;
  const R = (v: number) => 32 + v;
  return [
    `M${L(s.waistHalf)} ${TROUSER_WAIST_Y}`,
    seam(L(s.waistHalf), TROUSER_WAIST_Y, L(s.hipHalf), TROUSER_HIP_Y),
    seam(L(s.hipHalf), TROUSER_HIP_Y, L(s.kneeOuter), TROUSER_KNEE_Y),
    seam(L(s.kneeOuter), TROUSER_KNEE_Y, L(s.hemOuter), TROUSER_HEM_Y),
    `L${L(s.hemInner)} ${TROUSER_HEM_Y}`,
    seam(L(s.hemInner), TROUSER_HEM_Y, L(s.kneeInner), TROUSER_KNEE_Y),
    seam(L(s.kneeInner), TROUSER_KNEE_Y, 32, TROUSER_CROTCH_Y),
    seam(32, TROUSER_CROTCH_Y, R(s.kneeInner), TROUSER_KNEE_Y),
    seam(R(s.kneeInner), TROUSER_KNEE_Y, R(s.hemInner), TROUSER_HEM_Y),
    `L${R(s.hemOuter)} ${TROUSER_HEM_Y}`,
    seam(R(s.hemOuter), TROUSER_HEM_Y, R(s.kneeOuter), TROUSER_KNEE_Y),
    seam(R(s.kneeOuter), TROUSER_KNEE_Y, R(s.hipHalf), TROUSER_HIP_Y),
    seam(R(s.hipHalf), TROUSER_HIP_Y, R(s.waistHalf), TROUSER_WAIST_Y),
    'Z',
  ].join('');
}

interface TrouserCut {
  shape: TrouserShape;
  /** Main cloth, its shaded side, the waistband, and the topstitching/trim colour. */
  body: string;
  shade: string;
  band: string;
  stitch: string;
}

/**
 * One entry per `pants-*` id. The numbers ARE the description in constants/items.ts:
 * 直筒 keeps one width top to bottom, 錐形 is roomy at the hip and closes to the ankle,
 * 寬褲 opens out below the knee, 窄管 hugs all the way down, 工裝 is straight-ish but bulkier
 * than the classic cut because of what it is carrying.
 *
 * 牛仔 is the odd one out: its shape is near enough to 直筒's that the numbers alone would put two
 * blue trousers side by side in the 下裝 grid. What separates it is the CLOTH — raw indigo instead
 * of a washed mid-blue, orange thread instead of tan, copper rivets, and a turn-up at the hem — so
 * its detail branch carries more of the work than the others' do.
 *
 * COLOUR IS NO LONGER AUTHORED HERE. It comes from constants/pants.ts, for the same reason the
 * hats read theirs from constants/hats.ts, and the trousers needed it more: the 3D garment had
 * its own copy of this palette and five of the six cuts disagreed with the drawing below. A
 * player could buy the near-white 寬褲 in this grid and walk away in a dark slate pair. Only the
 * SHAPE is still authored at both ends, because these numbers are an SVG box describing both
 * legs at once and the 3D lathes one leg out of radii in metres - see the note in pants.ts.
 */
const TROUSER_CUTS: Record<string, TrouserCut> = {
  straight: {
    shape: { waistHalf: 12.5, hipHalf: 14, kneeOuter: 13, kneeInner: 3.2, hemOuter: 12.5, hemInner: 3 },
    ...PANTS_PALETTES.straight,
  },
  tapered: {
    shape: { waistHalf: 12.5, hipHalf: 16, kneeOuter: 14, kneeInner: 3.2, hemOuter: 10, hemInner: 3.4 },
    ...PANTS_PALETTES.tapered,
  },
  wide: {
    shape: { waistHalf: 12, hipHalf: 15, kneeOuter: 17.5, kneeInner: 3, hemOuter: 21, hemInner: 2.6 },
    ...PANTS_PALETTES.wide,
  },
  skinny: {
    shape: { waistHalf: 11.5, hipHalf: 12.8, kneeOuter: 9.5, kneeInner: 3, hemOuter: 7.6, hemInner: 3 },
    ...PANTS_PALETTES.skinny,
  },
  cargo: {
    shape: { waistHalf: 13, hipHalf: 15.5, kneeOuter: 14.5, kneeInner: 3.2, hemOuter: 13.5, hemInner: 3.2 },
    ...PANTS_PALETTES.cargo,
  },
  denim: {
    // Heavier than 直筒 everywhere and cut dead straight from the knee down, the way a rigid
    // 14oz leg hangs off the hip instead of following the thigh.
    shape: { waistHalf: 12.8, hipHalf: 15, kneeOuter: 13.6, kneeInner: 3.2, hemOuter: 13.6, hemInner: 3 },
    ...PANTS_PALETTES.denim,
  },
};

function TrouserIcon({
  cut: cutId, size, className, strokeColor, strokeWidth,
}: {
  cut: string;
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  const cut = TROUSER_CUTS[cutId] ?? TROUSER_CUTS.straight;
  const { shape: s, body, shade, band, stitch } = cut;

  // Centre line of one leg at the knee and at the hem. Detail is placed off these rather than
  // off typed-in coordinates, so a cut's pockets and cuffs follow its own leg instead of
  // drifting off the narrow ones and outside the wide one.
  const legMidKnee = (s.kneeOuter + s.kneeInner) / 2;
  const legMidHem = (s.hemOuter + s.hemInner) / 2;
  const hemBandY = TROUSER_HEM_Y - 3.6;

  const detail = (() => {
    switch (cutId) {
      case 'tapered':
        return (
          <>
            {/* Pleats falling from the waistband — the roomy front that makes the cut */}
            <path d={`M${32 - 5.5} 19.5C${32 - 6} 24 ${32 - 5.4} 27.5 ${32 - 4.6} 30`} stroke={shade} strokeWidth="1.7" strokeLinecap="round" />
            <path d={`M${32 + 5.5} 19.5C${32 + 6} 24 ${32 + 5.4} 27.5 ${32 + 4.6} 30`} stroke={shade} strokeWidth="1.7" strokeLinecap="round" />
            {/* Slanted side pockets */}
            <path d={`M${32 - s.hipHalf + 1.6} 19.4L${32 - s.hipHalf + 6.4} 25.6`} stroke={shade} strokeWidth="2" strokeLinecap="round" />
            <path d={`M${32 + s.hipHalf - 1.6} 19.4L${32 + s.hipHalf - 6.4} 25.6`} stroke={shade} strokeWidth="2" strokeLinecap="round" />
            {/* Turn-ups. A cuff is the giveaway detail of a carrot/tapered trouser. */}
            <path d={`M${32 - s.hemOuter + 0.5} ${hemBandY}H${32 - s.hemInner - 0.5}`} stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            <path d={`M${32 + s.hemOuter - 0.5} ${hemBandY}H${32 + s.hemInner + 0.5}`} stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            <path d={`M${32 - legMidHem} ${hemBandY + 1.4}v2.4M${32 + legMidHem} ${hemBandY + 1.4}v2.4`} stroke={shade} strokeWidth="1.3" strokeLinecap="round" />
          </>
        );
      case 'wide':
        return (
          <>
            {/* Drape folds instead of pockets: what you notice about a wide leg is the cloth
                moving, so the panel is left clean and the folds carry it. */}
            <path d={`M${32 - 9} 22C${32 - 11} 32 ${32 - 13} 42 ${32 - 14.5} ${TROUSER_HEM_Y - 1}`} stroke={shade} strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
            <path d={`M${32 - 5} 26C${32 - 6} 35 ${32 - 6.6} 44 ${32 - 7} ${TROUSER_HEM_Y - 1}`} stroke={shade} strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
            <path d={`M${32 + 9} 22C${32 + 11} 32 ${32 + 13} 42 ${32 + 14.5} ${TROUSER_HEM_Y - 1}`} stroke={shade} strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
            <path d={`M${32 + 5} 26C${32 + 6} 35 ${32 + 6.6} 44 ${32 + 7} ${TROUSER_HEM_Y - 1}`} stroke={shade} strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
            {/* Drawstring waist rather than a belt — this is a soft, pull-on trouser */}
            <path d="M29 18.6C29 21.4 28.2 23 26.8 24.6" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M35 18.6C35 21.4 35.8 23 37.2 24.6" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="32" cy="18.2" r="2" fill={stitch} stroke={strokeColor} strokeWidth="1.6" />
          </>
        );
      case 'skinny':
        return (
          <>
            {/* A sheen down each leg. On near-black cloth the highlight is the only thing that
                shows how closely the leg is following the body. */}
            <path d={`M${32 - legMidKnee - 1.4} 27C${32 - legMidKnee - 1.6} 36 ${32 - legMidHem - 1.2} 45 ${32 - legMidHem - 1} ${TROUSER_HEM_Y - 2}`} stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.14" />
            <path d={`M${32 + legMidKnee + 1.4} 27C${32 + legMidKnee + 1.6} 36 ${32 + legMidHem + 1.2} 45 ${32 + legMidHem + 1} ${TROUSER_HEM_Y - 2}`} stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.14" />
            {/* Back pockets at the seat */}
            <path d={`M${32 - 9.5} 21.5h6.4v4.2h-6.4zM${32 + 3.1} 21.5h6.4v4.2h-6.4z`} stroke={stitch} strokeWidth="1.3" fill="none" strokeLinejoin="round" />
            {/* Ankle zips — the detail that says the hem is too narrow to get a foot through */}
            <path d={`M${32 - legMidHem} ${TROUSER_HEM_Y - 5.6}v4.6M${32 + legMidHem} ${TROUSER_HEM_Y - 5.6}v4.6`} stroke={stitch} strokeWidth="1.5" strokeLinecap="round" />
          </>
        );
      case 'denim':
        return (
          <>
            {/* Whiskering: the pale creases worn in at the hip by sitting down. On indigo this is
                the first thing that says "denim" rather than "blue trousers". */}
            {[-1, 1].map((sideSign) => (
              <g key={sideSign} stroke="#FFFFFF" strokeLinecap="round" fill="none">
                <path d={`M${32 + sideSign * 2.6} 25.4C${32 + sideSign * 6} 25 ${32 + sideSign * 8.6} 25.6 ${32 + sideSign * 10.6} 26.8`} strokeWidth="1.5" opacity="0.28" />
                <path d={`M${32 + sideSign * 2.8} 28.8C${32 + sideSign * 6} 28.6 ${32 + sideSign * 8.4} 29.2 ${32 + sideSign * 10} 30.4`} strokeWidth="1.3" opacity="0.2" />
              </g>
            ))}
            {/* Faded knees, where the leg bends the cloth open every day. Soft and wide — a hard
                edge here reads as a patch sewn on rather than as wear. */}
            <path d={`M${32 - legMidKnee} ${TROUSER_KNEE_Y - 2.2}q0 2.6 0 4.4`} stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.06" />
            <path d={`M${32 + legMidKnee} ${TROUSER_KNEE_Y - 2.2}q0 2.6 0 4.4`} stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.06" />

            {/* Five-pocket front in orange thread, with a rivet at each corner — the bar-tack
                hardware the whole garment was patented around. The opening is kept short and
                steep: swept any further across the hip it stops reading as a pocket and starts
                reading as a brace strap. */}
            {[-1, 1].map((sideSign) => {
              const openTop = 32 + sideSign * (s.waistHalf - 1.6);
              const openEnd = 32 + sideSign * (s.waistHalf - 6.4);
              return (
                <g key={sideSign}>
                  <path d={`M${openTop} 19.6C${openTop} 21.8 ${openEnd + sideSign * 0.8} 23 ${openEnd} 24.6`} stroke={stitch} strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  <circle cx={openTop} cy="19.6" r="1" fill={DENIM_RIVET} stroke={strokeColor} strokeWidth="0.85" />
                  <circle cx={openEnd} cy="24.6" r="1" fill={DENIM_RIVET} stroke={strokeColor} strokeWidth="0.85" />
                </g>
              );
            })}
            {/* Coin pocket, and the fly curving off the centre line */}
            <path d={`M${32 + s.waistHalf - 5.8} 19.6v3.2h3.4`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" fill="none" />
            <path d="M32.7 18.8C33.8 22.2 33.8 25.6 32.7 29" stroke={stitch} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            {/* Doubled outseam topstitch, run all the way into the turn-up */}
            <path d={`M${32 - s.kneeOuter - 0.4} 33C${32 - s.kneeOuter - 0.2} 43 ${32 - s.hemOuter - 0.2} 50 ${32 - s.hemOuter - 0.2} ${TROUSER_HEM_Y - 2}`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" opacity="0.75" fill="none" />
            <path d={`M${32 + s.kneeOuter + 0.4} 33C${32 + s.kneeOuter + 0.2} 43 ${32 + s.hemOuter + 0.2} 50 ${32 + s.hemOuter + 0.2} ${TROUSER_HEM_Y - 2}`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" opacity="0.75" fill="none" />
            {/* The red tab on the seat, small enough to be a colour note and no more */}
            <path d={`M${32 - s.hipHalf + 2.2} 22.2h3.4v1.9h-3.4z`} fill="#C0392B" stroke={strokeColor} strokeWidth="0.8" strokeLinejoin="round" />

            {/* Turn-up: one fold of the leg rolled back on itself, showing the pale inside of the
                cloth. Painted as a band clipped to the garment's own outline, so it follows
                whatever width the hem happens to be instead of being typed to fit it. */}
            <g clipPath={`url(#trouser-clip-${cutId})`}>
              <rect x="0" y={TROUSER_HEM_Y - 4.6} width="64" height="4.6" fill={DENIM_TURNUP} />
              <rect x="32" y={TROUSER_HEM_Y - 4.6} width="32" height="4.6" fill={shade} opacity="0.22" />
            </g>
            <path d={`M${32 - s.hemOuter - 0.4} ${TROUSER_HEM_Y - 4.6}H${32 - s.hemInner + 0.4}M${32 + s.hemOuter + 0.4} ${TROUSER_HEM_Y - 4.6}H${32 + s.hemInner - 0.4}`} stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            <path d={`M${32 - s.hemOuter + 0.8} ${TROUSER_HEM_Y - 1.8}H${32 - s.hemInner - 0.8}M${32 + s.hemOuter - 0.8} ${TROUSER_HEM_Y - 1.8}H${32 + s.hemInner + 0.8}`} stroke={stitch} strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />
          </>
        );
      case 'cargo':
        return (
          <>
            {/* The thigh pockets, which are the entire point of the garment: big, flapped,
                buttoned, and sitting proud of the leg. */}
            {[-1, 1].map((sideSign) => {
              const x = 32 + sideSign * legMidKnee - 5.2;
              return (
                <g key={sideSign}>
                  <rect x={x} y="30.4" width="10.4" height="9.6" rx="1.8" fill={shade} stroke={strokeColor} strokeWidth="1.9" strokeLinejoin="round" />
                  <path d={`M${x} 33.8h10.4`} stroke={strokeColor} strokeWidth="1.7" />
                  <circle cx={x + 5.2} cy="35.6" r="1.15" fill={stitch} stroke={strokeColor} strokeWidth="1" />
                  <path d={`M${x + 2} 37.6h6.4`} stroke={stitch} strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
                </g>
              );
            })}
            {/* Reinforced knee seam */}
            <path d={`M${32 - s.kneeOuter + 1} 43.4h${(s.kneeOuter - s.kneeInner) - 2}M${32 + s.kneeOuter - 1} 43.4h-${(s.kneeOuter - s.kneeInner) - 2}`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
            {/* Cinched hems */}
            <path d={`M${32 - s.hemOuter + 0.6} ${hemBandY}H${32 - s.hemInner - 0.6}M${32 + s.hemOuter - 0.6} ${hemBandY}H${32 + s.hemInner + 0.6}`} stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          </>
        );
      default:
        // 直筒褲 — the five-pocket denim the other four are variations on.
        return (
          <>
            {/* Curved front pocket openings */}
            <path d={`M${32 - s.waistHalf + 1.4} 19C${32 - s.waistHalf + 2.6} 23.4 ${32 - s.hipHalf + 6} 25.6 ${32 - s.hipHalf + 8.6} 26`} stroke={stitch} strokeWidth="1.4" strokeLinecap="round" fill="none" />
            <path d={`M${32 + s.waistHalf - 1.4} 19C${32 + s.waistHalf - 2.6} 23.4 ${32 + s.hipHalf - 6} 25.6 ${32 + s.hipHalf - 8.6} 26`} stroke={stitch} strokeWidth="1.4" strokeLinecap="round" fill="none" />
            {/* Coin pocket */}
            <path d={`M${32 + s.waistHalf - 5.6} 19.4v3.4h3.6`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" fill="none" />
            {/* Fly, curving off the centre line the way a real one does */}
            <path d="M32.6 18.8C33.6 22 33.6 25.4 32.6 28.6" stroke={stitch} strokeWidth="1.4" strokeLinecap="round" fill="none" />
            {/* Topstitched outseams, doubled — the denim signature */}
            <path d={`M${32 - s.kneeOuter - 0.4} 34C${32 - s.kneeOuter - 0.2} 42 ${32 - s.hemOuter - 0.2} 48 ${32 - s.hemOuter - 0.2} ${TROUSER_HEM_Y - 2}`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" opacity="0.8" fill="none" />
            <path d={`M${32 + s.kneeOuter + 0.4} 34C${32 + s.kneeOuter + 0.2} 42 ${32 + s.hemOuter + 0.2} 48 ${32 + s.hemOuter + 0.2} ${TROUSER_HEM_Y - 2}`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" opacity="0.8" fill="none" />
            {/* Hem stitching */}
            <path d={`M${32 - s.hemOuter + 0.8} ${hemBandY}H${32 - s.hemInner - 0.8}M${32 + s.hemOuter - 0.8} ${hemBandY}H${32 + s.hemInner + 0.8}`} stroke={stitch} strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
          </>
        );
    }
  })();

  return (
    // One crop for every cut, not one per cut: the box is sized to the WIDEST trouser (寬褲) plus
    // its shadow, so the whole row scales up together and 寬褲 still comes out visibly wider than
    // 窄管 instead of every cut being blown up to fill its own tile.
    <svg width={size} height={size} viewBox="4.5 9 55 55" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Derived from the hem rather than typed, so lengthening the leg takes the ground shadow
          with it instead of leaving it floating across the trouser cuffs. */}
      <ellipse cx="32" cy={TROUSER_HEM_Y + 2} rx={s.hemOuter + 3} ry="1.9" fill={strokeColor} opacity="0.12" />

      {/* The garment: one path, legs joined at the crotch. */}
      <path d={trouserOutline(s)} fill={body} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />

      {/* Right half shaded, so the cloth has a light side and a dark side rather than reading
          as a flat sticker. Clipped to the garment by re-using its own outline as the mask. */}
      <clipPath id={`trouser-clip-${cutId}`}>
        <path d={trouserOutline(s)} />
      </clipPath>
      <g clipPath={`url(#trouser-clip-${cutId})`}>
        <rect x="32" y="0" width="32" height="64" fill={shade} opacity="0.2" />
      </g>

      {detail}

      {/* Waistband last: it caps the top of the garment and every belt detail sits on it. */}
      <rect x={32 - s.waistHalf} y="11.4" width={s.waistHalf * 2} height="6.4" rx="2.2" fill={band} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {cutId === 'wide' ? (
        <path d={`M${32 - s.waistHalf + 3} 14.6H${32 + s.waistHalf - 3}`} stroke={stitch} strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      ) : (
        <>
          {/* Belt loops straddling the band, and the button that closes it */}
          <path d={`M${32 - s.waistHalf + 3.4} 10.6v8.2M${32 + s.waistHalf - 3.4} 10.6v8.2`} stroke={band} strokeWidth="2.6" strokeLinecap="round" />
          <path d={`M${32 - s.waistHalf + 3.4} 10.6v8.2M${32 + s.waistHalf - 3.4} 10.6v8.2`} stroke={strokeColor} strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />
          <circle cx="32" cy="17.4" r="1.5" fill={stitch} stroke={strokeColor} strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   GRASS SKIRT (下裝 / `item-0` 熱帶草裙)
   ---------------------------------------------------------------------------
   This is 下裝, so it is drawn flat-lay on the trousers' own stations above and
   shares their waistband rect and their crop — a skirt and a pair of trousers
   in the same shop row have to line up at the waist.

   The icon this replaces read as a JELLYFISH, and every cause of that is a
   thing a skirt does not do:
     - a bright green band, domed on top, with the fringe hanging out of it —
       that silhouette is a bell;
     - twelve strands of identical width and identical length, falling dead
       straight in a rectangle — tentacles;
     - `rounded-full` on each strand, so they all finished in a soft blob
       instead of a cut point;
     - the whole thing undulating on an infinite loop, which is the one motion
       a jellyfish is famous for.

   What makes it a hula skirt instead, in the order the eye picks it up:
     - the band is WOVEN STRAW — flat, plaited, tan. A visibly different
       material from what hangs off it, so the top of the icon is a belt rather
       than a body;
     - the fringe FLARES, half again as wide at the hem as at the waist,
       because a skirt hangs off hips and swings;
     - the hem is CUT: an irregular sawtooth of pointed tips at uneven depths,
       with the partings carried up under the band so the panel reads as many
       bound strands and not as a sheet with a zigzag bitten out of it;
     - a hibiscus and a frangipani tucked into the band, which is the detail
       nobody mistakes for anything else.
   It is also completely still. */

/** Fixed pseudo-random in [0,1). The fringe must look hand-cut but be the SAME hand-cut fringe
 *  on every render — Math.random() here would re-roll the hem underneath the player. */
function skirtNoise(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** The trousers' waist half-width, so the band caps this garment at exactly their width. */
const SKIRT_WAIST_HALF = 12.8;
/** Where the strands are bound in — behind the band, which is drawn last and hides the knot. */
const SKIRT_BIND_Y = 13;
/** The centre strand's tip. Near the trousers' hem, so the 下裝 row bottoms out together. */
const SKIRT_HEM_Y = 57;

/**
 * The fringe is stroked thinner than the trousers' 2.5. A sawtooth hem packs an order of
 * magnitude more stroke into the same area than a smooth outline does — at 2.5 the outlines of
 * neighbouring strands meet and the bottom third of the icon turns into one brown mass with no
 * green left in it. This is the lightest weight that still reads as the same hand-drawn line.
 */
const SKIRT_FRINGE_STROKE = '2';

const SKIRT = {
  blade: '#7FB03C',
  bladeLight: '#B7DA72',
  /** Only a little darker than the blade: the layer behind has to separate, not go to shadow. */
  bladeBack: '#5F8C30',
  bladeDark: '#4F7527',
  band: '#C9A05A',
  bandShade: '#A87F3E',
  weave: '#EBD3A0',
  hibiscus: '#E4573D',
  frangipani: '#FBF0DA',
  pollen: '#F2C14E',
};

interface SkirtLayer {
  count: number;
  /** Half-width at the hem. It is larger than SKIRT_WAIST_HALF, and that difference IS the flare. */
  hemHalf: number;
  hemY: number;
  /** How much higher the outermost tips sit than the centre one: this hangs around a body. */
  rise: number;
  /** Which fringe to cut. Two layers on different salts never line their tips up. */
  salt: number;
}

interface SkirtFringe {
  outline: string;
  /** One per notch: the cut carried up under the band, so the strands are bound, not merely edged. */
  partings: string[];
  /** A lit centre on some strands, placed between partings so it lands ON a strand, not in a gap. */
  veins: string[];
}

/**
 * One layer of the skirt as a single closed path — down the left side, along the CUT hem, up the
 * right — following the same rule as {@link trouserOutline}: the garment is one piece, so the
 * separations between strands are notches cut into it rather than gaps between shapes.
 *
 * The notches are cut to wildly different depths on purpose. Even notches produce a pinked edge
 * and even strands produce tentacles; only an irregular cut reads as a bundle of dried grass.
 */
function skirtFringe(layer: SkirtLayer): SkirtFringe {
  const tips = Array.from({ length: layer.count }, (_, i) => {
    const t = (i / (layer.count - 1)) * 2 - 1;
    return {
      t,
      x: 32 + t * layer.hemHalf + (skirtNoise(i, layer.salt) - 0.5) * 1.6,
      y: layer.hemY - layer.rise * t * t + (skirtNoise(i, layer.salt + 1) - 0.5) * 5,
    };
  });

  // Shallow, and never deeper than the strand beside it is wide. Cutting further up makes each
  // strand narrower than its own outline, which is how a fringe turns into a solid dark comb —
  // the staggered TIP heights above do the "hand-cut" work instead, at no cost in ink.
  const notches = tips.slice(0, -1).map((a, i) => {
    const b = tips[i + 1]!;
    return {
      x: (a.x + b.x) / 2,
      y: Math.min(a.y, b.y) - (3.2 + skirtNoise(i, layer.salt + 2) * 4.6),
    };
  });

  const p = (n: number) => n.toFixed(2);
  /** A strand's own line: it leaves the waist at the same rate the hem flares, so nothing crosses. */
  const atWaist = (x: number) => 32 + ((x - 32) / layer.hemHalf) * SKIRT_WAIST_HALF * 0.9;

  const first = tips[0]!;
  const last = tips[tips.length - 1]!;
  const outline = [
    `M${p(32 - SKIRT_WAIST_HALF)} ${SKIRT_BIND_Y}`,
    seam(32 - SKIRT_WAIST_HALF, SKIRT_BIND_Y, first.x, first.y),
    tips.slice(1).map((tip, i) => `L${p(notches[i]!.x)} ${p(notches[i]!.y)}L${p(tip.x)} ${p(tip.y)}`).join(''),
    seam(last.x, last.y, 32 + SKIRT_WAIST_HALF, SKIRT_BIND_Y),
    'Z',
  ].join('');

  const partings = notches.map((n) => {
    const top = atWaist(n.x);
    return `M${p(top)} ${SKIRT_BIND_Y + 2.6}${seam(top, SKIRT_BIND_Y + 2.6, n.x, n.y)}`;
  });

  const veins = tips
    .filter((_, i) => i % 3 === 1)
    .map((tip) => {
      const top = atWaist(tip.x);
      return `M${p(top)} ${SKIRT_BIND_Y + 5}${seam(top, SKIRT_BIND_Y + 5, tip.x, tip.y - 5)}`;
    });

  return { outline, partings, veins };
}

/**
 * A five-petal tropical bloom, tucked into the waistband. Built from circles rather than drawn
 * petal by petal because at 56px the petal outlines are the only thing that survives anyway —
 * what has to read is "round flower, five lobes, bright centre".
 */
function SkirtFlower({
  cx, cy, r, petal, strokeColor,
}: {
  cx: number;
  cy: number;
  r: number;
  petal: string;
  strokeColor: string;
}) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map((deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        return (
          <circle
            key={deg}
            cx={cx + Math.cos(a) * r * 0.62}
            cy={cy + Math.sin(a) * r * 0.62}
            r={r * 0.52}
            fill={petal}
            stroke={strokeColor}
            strokeWidth="0.9"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.3} fill={SKIRT.pollen} stroke={strokeColor} strokeWidth="0.8" />
    </g>
  );
}

function GrassSkirtIcon({
  size, className, strokeColor, strokeWidth,
}: {
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  // Two layers, and the back one is deliberately NARROWER and steeper-hemmed than the front, so it
  // stays inside the front's silhouette everywhere and is seen only hanging through the notches.
  // A back layer wider than the front instead adds a wedge down each side which — being two
  // outlines with barely any fill between them — reads as a pair of dark wings, not as depth.
  const frontHemHalf = 19.6;
  const back = skirtFringe({ count: 9, hemHalf: 17.5, hemY: 54, rise: 11, salt: 5 });
  const front = skirtFringe({ count: 11, hemHalf: frontHemHalf, hemY: SKIRT_HEM_Y, rise: 6, salt: 1 });

  // The trousers' crop, unchanged, so 草裙 scales with the row instead of filling its own tile.
  return (
    <svg width={size} height={size} viewBox="4.5 9 55 55" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Derived from the hem, like the trousers' shadow, so widening the flare takes the ground
          shadow with it instead of leaving it tucked under the fringe. */}
      <ellipse cx="32" cy={SKIRT_HEM_Y + 2.4} rx={frontHemHalf + 3} ry="1.9" fill={strokeColor} opacity="0.12" />

      <path d={front.outline} fill={SKIRT.blade} stroke={strokeColor} strokeWidth={SKIRT_FRINGE_STROKE} strokeLinejoin="round" />

      {/* Everything else is masked by the skirt, exactly as the trousers do it, so a parting can be
          drawn straight through a notch without spilling out of the garment. */}
      <clipPath id="grass-skirt-clip">
        <path d={front.outline} />
      </clipPath>
      <g clipPath="url(#grass-skirt-clip)">
        {/* The layer behind, carrying no outline of its own: it is never the silhouette edge, and
            an outline here would only add dark inside the notches — the one place along the hem
            that cannot afford any. The clip is what guarantees it stays behind: unclipped, the odd
            strand of it escapes below the hem as a thin unoutlined sliver that reads as a glitch
            rather than as a strand. */}
        <path d={back.outline} fill={SKIRT.bladeBack} />
        <rect x="32" y="0" width="32" height="64" fill={SKIRT.bladeDark} opacity="0.2" />
        {front.veins.map((d, i) => (
          <path key={i} d={d} stroke={SKIRT.bladeLight} strokeWidth="1.9" strokeLinecap="round" opacity="0.5" />
        ))}
        {front.partings.map((d, i) => (
          <path key={i} d={d} stroke={SKIRT.bladeDark} strokeWidth="1.15" strokeLinecap="round" opacity="0.7" />
        ))}
      </g>

      {/* Woven straw band last — it caps the bound ends of every strand, the way the trousers'
          waistband caps theirs. Plaited, not striped: the chevrons are the weave itself. */}
      <rect
        x={32 - SKIRT_WAIST_HALF} y="11.4" width={SKIRT_WAIST_HALF * 2} height="6.4" rx="2.2"
        fill={SKIRT.band} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
      />
      {Array.from({ length: 7 }, (_, i) => {
        const w = (SKIRT_WAIST_HALF * 2 - 2.4) / 7;
        const x = 32 - SKIRT_WAIST_HALF + 1.2 + i * w;
        return (
          <path
            key={i}
            d={`M${x.toFixed(2)} 16.5L${(x + w / 2).toFixed(2)} 12.7L${(x + w).toFixed(2)} 16.5`}
            stroke={SKIRT.weave} strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"
          />
        );
      })}
      <path
        d={`M${32 - SKIRT_WAIST_HALF + 1.8} 16.9H${32 + SKIRT_WAIST_HALF - 1.8}`}
        stroke={SKIRT.bandShade} strokeWidth="1.3" strokeLinecap="round" opacity="0.85"
      />

      {/* Worn at the hip, where they are actually pinned — not centred, which would read as a
          badge stuck on the front of the belt. */}
      <SkirtFlower cx={23.4} cy={14.6} r={3.5} petal={SKIRT.hibiscus} strokeColor={strokeColor} />
      <SkirtFlower cx={40.2} cy={15} r={2.7} petal={SKIRT.frangipani} strokeColor={strokeColor} />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   JACKET (上衣 / `top-jacket`)
   ---------------------------------------------------------------------------
   Drawn flat-lay and front-on, the same way the trousers above are, so 上衣 and
   下裝 read as one wardrobe rather than two illustration styles.

   The silhouette is one closed path — collar edge, out along the shoulder, down
   the outer sleeve, across the cuff, back up to the armpit, down the side, round
   the hem, and mirrored home. Sleeves are part of that outline instead of two
   rectangles pasted onto a torso, because the shoulder seam is exactly where a
   pasted-on sleeve gives itself away at 56px.

   What makes it read as 夾克 specifically, rather than as a shirt: the three
   knitted ribs (collar, cuffs, hem) and the fact that the hem rib is NARROWER
   than the chest, which is the blouson shape no shirt has. The zip runs the full
   length and the orange lining shows under the open collar — a flight jacket's
   two signatures, and the only warm colour in the piece. */
const JACKET = {
  body: '#6E7C4F',
  shade: '#56623C',
  /** Knitted collar/cuffs/hem — the same yarn, so one colour for all three. */
  rib: '#4B5535',
  lining: '#E08A3C',
  metal: '#EADFC4',
};

/** Collar and hem rib both key off these, so the two bands stay the same weight. */
const JACKET_SHOULDER_Y = 20.5;
const JACKET_HEM_Y = 51.5;
const JACKET_RIB_TOP_Y = 46.5;

const JACKET_OUTLINE = [
  'M19.5 20.5',
  'C16.6 25.2 12 32.2 8.6 37.5', // left outer sleeve, dropped rather than held out sideways so
  'L15.2 41.7',                  // the arm reads full length inside a box only 64 wide
  'C16.4 38.4 17.9 34.2 19.5 30.5', // back up the underarm
  'C19.8 36 20.2 41.4 20.5 46.5',   // left side seam
  'C20.8 48.4 21.1 50 21.5 51.5',   // drawn in by the hem rib
  'L42.5 51.5',
  'C42.9 50 43.2 48.4 43.5 46.5',
  'C43.8 41.4 44.2 36 44.5 30.5',
  'C46.1 34.2 47.6 38.4 48.8 41.7',
  'L55.4 37.5',
  'C52 32.2 47.4 25.2 44.5 20.5',
  'L38.5 17.4',                 // shoulder line into the neck
  'L25.5 17.4',
  'Z',
].join('');

/** The hem rib as its own shape: the bottom of the outline, cut off at the rib seam. */
const JACKET_HEM_RIB = 'M20.5 46.5C20.8 48.4 21.1 50 21.5 51.5L42.5 51.5C42.9 50 43.2 48.4 43.5 46.5Z';

function JacketIcon({
  size, className, strokeColor, strokeWidth,
}: {
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  return (
    // Cropped to the garment instead of sitting in the middle of an empty 64-box: the art runs
    // edge to edge in its tile, at the size the legacy 上衣 icons next to it are drawn.
    <svg width={size} height={size} viewBox="7.2 8.4 49.6 49.6" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <ellipse cx="32" cy={JACKET_HEM_Y + 2.6} rx="15" ry="2" fill={strokeColor} opacity="0.12" />

      <path d={JACKET_OUTLINE} fill={JACKET.body} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />

      {/* Lining, showing where the collar stands open. Laid over the body and under the collar,
          which is the only gap it can actually be seen through. */}
      <path d="M26.4 16.4h11.2v4.4a12 12 0 0 1-11.2 0Z" fill={JACKET.lining} stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />

      <clipPath id="jacket-clip">
        <path d={JACKET_OUTLINE} />
      </clipPath>
      <g clipPath="url(#jacket-clip)">
        {/* Light side / dark side, exactly as the trousers do it */}
        <rect x="32" y="0" width="32" height="64" fill={JACKET.shade} opacity="0.2" />
        {/* Raglan-ish shoulder shading, so the sleeves sit behind the chest panel */}
        <path d={`M19.5 ${JACKET_SHOULDER_Y}C16.6 25.2 12 32.2 8.6 37.5L15.2 41.7C16.4 38.4 17.9 34.2 19.5 30.5Z`} fill={JACKET.shade} opacity="0.28" />
        <path d={`M44.5 ${JACKET_SHOULDER_Y}C47.4 25.2 52 32.2 55.4 37.5L48.8 41.7C47.6 38.4 46.1 34.2 44.5 30.5Z`} fill={JACKET.shade} opacity="0.28" />
      </g>

      {/* Hem rib: knitted, cinched, and the reason this is a blouson */}
      <path d={JACKET_HEM_RIB} fill={JACKET.rib} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {[24, 27, 30, 33, 36, 39].map((x) => (
        <path key={x} d={`M${x} ${JACKET_RIB_TOP_Y + 1.4}v3.2`} stroke={strokeColor} strokeWidth="0.9" strokeLinecap="round" opacity="0.3" />
      ))}

      {/* Cuff ribs, squared off across the end of each sleeve */}
      <path d="M8.6 37.5L15.2 41.7L17.7 37.9L11.1 33.6Z" fill={JACKET.rib} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M55.4 37.5L48.8 41.7L46.3 37.9L52.9 33.6Z" fill={JACKET.rib} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />

      {/* Sleeve utility pocket, rotated onto the sleeve's own axis rather than sat flat */}
      <g transform="rotate(32.7 15.5 32.4)">
        <rect x="13.4" y="29.6" width="4.2" height="5.6" rx="1.3" fill={JACKET.shade} stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M15.5 30.4v4" stroke={JACKET.metal} strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      </g>

      {/* Zip, full length: a dark tape with the teeth picked out on top of it. The teeth are kept
          fine and low-contrast — at 56px a bolder dash reads as a row of buttons. */}
      <path d={`M32 18.6V${JACKET_RIB_TOP_Y}`} stroke={strokeColor} strokeWidth="2.4" strokeLinecap="round" />
      <path d={`M32 19.4V${JACKET_RIB_TOP_Y - 1}`} stroke={JACKET.metal} strokeWidth="0.9" strokeLinecap="butt" strokeDasharray="0.8 1.1" opacity="0.6" />
      <rect x="30.3" y="30.6" width="3.4" height="4.2" rx="1.2" fill={JACKET.metal} stroke={strokeColor} strokeWidth="1.3" strokeLinejoin="round" />

      {/* Slash pockets, angled the way hands go into them */}
      <path d="M24.2 38.4L28.6 42.2" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M39.8 38.4L35.4 42.2" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.7" />

      {/* Collar last, capping the neck and covering the top of the zip tape */}
      <rect x="25.2" y="11.6" width="13.6" height="6.6" rx="2.6" fill={JACKET.rib} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {[28, 30.6, 33.4, 36].map((x) => (
        <path key={x} d={`M${x} 13.2v3.4`} stroke={strokeColor} strokeWidth="0.9" strokeLinecap="round" opacity="0.3" />
      ))}
    </svg>
  );
}

/**
 * 寵物 — 狗. Every `pet-dog-*` id in constants/items.ts resolves here, keyed by the suffix.
 *
 * One component instead of a case per breed because all three share a body plan: a barrel body on
 * four legs, a big Q-version head, and the same two-dot face. What differs is only what a player
 * actually names the breed by — 臘腸's long low body and hanging ears, 紅貴賓's curl-covered
 * silhouette and pom tail, 柴犬's cream mask and curled tail — so those are what this switches on.
 *
 * Colours come from constants/pets.ts, the same table Three/Pets.tsx builds the 3D companion
 * from, so the dog on the card and the dog standing next to the character cannot drift apart.
 *
 * Drawn three-quarter front, facing right, standing on the tile's baseline (~y 55) so the wrapper's
 * contact shadow lands under the paws. No collar, prop or plinth: the shop tile supplies the
 * ground, and an accessory here would read as part of the pet the player is buying.
 */
/** Where every pet's paws land, so they all share one ground line. */
const LEG_BASELINE = 55;

interface PetPartProps {
  c: PetSpec;
  strokeColor: string;
  strokeWidth: string;
}

/**
 * The four legs, shared by every pet so no two animals stand differently.
 *
 * Two rules do all the work. Every leg is the same rounded shape and every leg ends on the same
 * baseline, so the set reads as one stance rather than four separately-placed pieces. And the
 * whole block is drawn BEFORE the body: laid over it instead, each leg keeps its own closed
 * outline and reads as a pill stuck on underneath — with the body on top, the leg simply carries
 * on into it and the join disappears. Everything else that meets the body (chests, curls, ears)
 * is stacked the same way, so the animal has no seams anywhere.
 *
 * That also means no breed sets a leg's length. How much of each shows is decided by the body
 * outline hanging over it, which is why a dachshund's forelegs come out shorter than its hind
 * pair on their own: the deep chest covers more of them.
 *
 * `backX`/`frontX` are the near pair; the far pair sits `offset` behind, shaded, on a thinner
 * outline — the same depth cue the far ears use.
 */
function PetLegs({
  c, strokeColor, strokeWidth, backX, frontX, offset = -4.2, nearW = 5.6, farW = 4.8, top = 40,
}: PetPartProps & {
  backX: number; frontX: number; offset?: number; nearW?: number; farW?: number; top?: number;
}) {
  const leg = (x: number, w: number, fill: string, sw: string) => (
    <rect
      x={x} y={top} width={w} height={LEG_BASELINE - top} rx={w / 2}
      fill={fill} stroke={strokeColor} strokeWidth={sw}
    />
  );
  return (
    <>
      {leg(backX + offset, farW, c.shade, '1.8')}
      {leg(frontX + offset, farW, c.shade, '1.8')}
      {leg(backX, nearW, c.coat, strokeWidth)}
      {leg(frontX, nearW, c.coat, strokeWidth)}
    </>
  );
}

/**
 * The shared face: two eyes, positioned per breed by the muzzle that carries them.
 *
 * `r` scales the whole eye — pupil and catchlight together — so an animal drawn on a bigger skull
 * keeps the same eye-to-head ratio rather than looking beady. The dogs pass it; the cats sit on the
 * default, which is the size every pet used before the dogs' heads grew.
 */
function PetEyes({ leftX, rightX, y, strokeColor, r = 1.9, rFar = r }: {
  leftX: number; rightX: number; y: number; strokeColor: string; r?: number;
  /**
   * The FAR eye's radius, for a head drawn in 3/4 rather than flat-on.
   *
   * On a face turned to the right the right eye is the one going away from the viewer: it
   * foreshortens and crowds the skull's contour, while the left eye keeps its room. Drawing the
   * pair identical is what makes a 3/4 head read as eyes painted on the front of a face whose
   * muzzle is in profile — the two halves of the head end up in different views. Defaults to `r`,
   * so every flat-on face on the shelf is untouched.
   */
  rFar?: number;
}) {
  return (
    <>
      <circle cx={leftX} cy={y} r={r} fill={strokeColor} />
      <circle cx={rightX} cy={y} r={rFar} fill={strokeColor} />
      <circle cx={leftX + r * 0.316} cy={y - r * 0.368} r={r * 0.316} fill="#FFFFFF" opacity="0.9" />
      <circle cx={rightX + rFar * 0.316} cy={y - rFar * 0.368} r={rFar * 0.316} fill="#FFFFFF" opacity="0.9" />
    </>
  );
}

function DogIcon({
  breed, size, className, strokeColor, strokeWidth,
}: {
  breed: string;
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  const c = PET_SPECS[breed] ?? PET_SPECS.shiba;

  const legs = (p: { backX: number; frontX: number; offset?: number; nearW?: number; farW?: number; top?: number }) =>
    <PetLegs c={c} strokeColor={strokeColor} strokeWidth={strokeWidth} {...p} />;
  // Bigger than the shared default, because every skull below grew — see PetEyes' `r`.
  const eyes = (leftX: number, rightX: number, y: number, r = 2.4) =>
    <PetEyes leftX={leftX} rightX={rightX} y={y} r={r} strokeColor={strokeColor} />;

  const art = (() => {
    switch (breed) {
      // 臘腸犬 — the silhouette IS the breed: a body twice as long as it is tall, legs barely
      // clearing the ground, ears hanging past the jaw and a fine tapered muzzle.
      case 'dachshund':
        return (
          <>
            {/* Tail: a bold upward sweep continuing the topline, not a hook. Thick enough to still
                be a tail at chip size — the old 2.8 coat line over a 5.2 outline was a hair. */}
            <path d="M13 33.5C6 31 3.6 24 5.6 16.5" fill="none" stroke={strokeColor} strokeWidth="7.8" strokeLinecap="round" />
            <path d="M13 33.5C6 31 3.6 24 5.6 16.5" fill="none" stroke={c.coat} strokeWidth="4.4" strokeLinecap="round" />
            {/* Set under the ends of the body, not under its middle: pulled in, the deep chest
                overhangs the front pair and the dog reads as tipping forward off its own feet. */}
            {legs({ backX: 11, frontX: 36.5, offset: -5, nearW: 7, farW: 6 })}
            {/* Long low body. A path rather than a rounded rect so the front can carry the breed's
                deep chest: the underline drops well below the belly between the forelegs and comes
                back up, which is the prominent breastbone the whole standard is built around — and
                it is what leaves this breed's forelegs barely clearing the ground. */}
            <path
              d="M11 28.5H35C42.6 28.5 47 33 47 39.8C47 47 42.4 51.2 36.4 51.2C31 51.2 27.4 49 25.4 47H14.5C7.6 47 4 43.4 4 38C4 32 7 28.5 11 28.5Z"
              fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* Lighter underline along the belly */}
            <path d="M10 44.4H25" stroke={c.accent} strokeWidth="3.2" strokeLinecap="round" opacity="0.6" />
            {/* Far ear, mostly behind the head */}
            <path d="M50.5 14.5C55.2 16.4 56.8 23.4 55.2 29C54 32.8 50.6 32.6 49.9 28.4C49 23 47.6 16.9 50.5 14.5Z" fill={c.dark} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
            {/* Head: wide forehead narrowing into the muzzle */}
            <circle cx="43.5" cy="20.5" r="12.2" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Long muzzle tapering to the breed's big nose */}
            <path d="M46.5 22C52.4 21 58.6 22.6 61 25.8C62.2 27.4 61 29.8 57.4 30.6C51.4 31.8 47 29.4 45.6 26.8Z" fill={c.coat} stroke={strokeColor} strokeWidth="2.2" strokeLinejoin="round" />
            <ellipse cx="59.4" cy="26.4" rx="3.1" ry="2.7" fill={strokeColor} />
            {/* Near ear: set high on the skull, hanging flat past the jaw with a rounded tip */}
            <path d="M36.5 12.4C30.6 14.4 29.2 24 31.8 31.4C34 37.6 40 36.8 41 30.8C42.2 23.2 42 14.4 36.5 12.4Z" fill={c.dark} stroke={strokeColor} strokeWidth="2.2" strokeLinejoin="round" />
            {eyes(43.5, 52, 18)}
          </>
        );

      // 紅貴賓 — read entirely off the curls: a round head pom, pom cuffs at the ankles and a pom
      // tail, all in the same apricot so the silhouette is scalloped rather than smooth.
      case 'poodle':
        return (
          <>
            {/* Tail carried high: a clipped stem with the sporting clip's pompon on the end. The
                stem is what makes it read as a tail — a bare pom floating at the rump could have
                been any part of the dog, which is exactly how the first pass failed. */}
            {/* Carried high and clear of the coat. The stem is drawn behind the body like every
                other part here, so it only reads as a stem where it clears the topline curls —
                ending it down among them left the pom floating free like a balloon on a string. */}
            <path d="M19 30L11 20" stroke={strokeColor} strokeWidth="6" strokeLinecap="round" />
            <path d="M19 30L11 20" stroke={c.shade} strokeWidth="3" strokeLinecap="round" />
            <circle cx="8.6" cy="16.6" r="5.8" fill={c.coat} stroke={strokeColor} strokeWidth="2.2" />
            {/* Clipped bare, so this breed's legs stay thin — the coat's volume is the contrast the
                whole dog is drawn on, and legs as fat as the body erase it. Set wide apart even so:
                thin legs bunched under the middle of the body were the main reason this one read as
                a single lump rather than a dog standing on four of them. */}
            {legs({ backX: 22, frontX: 38, offset: -4.4, nearW: 5, farW: 4.2, top: 38 })}
            {/* Chest, deepening the front so the forelegs come out the same length as the hind pair.
                Behind the body, so only the part that hangs below it shows — which is also what
                bridges the head down into the shoulders on a breed this compact. */}
            <ellipse cx="38" cy="36" rx="8" ry="10.5" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Curls breaking the topline. Drawn BEHIND the body on purpose: laid on top, each one
                keeps its own full outline and the dog becomes a heap of circles with seams through
                it — from behind, only the part that clears the back shows, which is what reads as
                a scalloped coat. Every pom on this breed is stacked that way.

                Three big scallops rather than a row of small ones: at chip size a 3.9-radius bump
                on a 9-radius body is a ripple, and the coat's whole point is that it is lumpy. */}
            {[[16.5, 31], [25, 27.6], [33.5, 30]].map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="5.6" fill={c.coat} stroke={strokeColor} strokeWidth="2" />
            ))}
            {/* Compact body — a toy poodle is about as long as it is tall */}
            <ellipse cx="25.5" cy="37" rx="13.5" ry="11" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M18.5 39.5q3.2 2.8 6.4 0M25.5 43.6q3.2 2.8 6.4 0" stroke={c.shade} strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.75" />
            {/* The clip's ankle bracelets, left on where the rest of the leg is shaved */}
            <circle cx="24.5" cy="51.4" r="4.6" fill={c.coat} stroke={strokeColor} strokeWidth="2" />
            <circle cx="40.5" cy="51.4" r="4.6" fill={c.coat} stroke={strokeColor} strokeWidth="2" />
            {/* Far ear, tucked behind the skull. Kept small and high: sized like the near ear it
                fought the muzzle for the same corner and the two merged into one lump. */}
            <path d="M51.5 15.5C56 16.8 57.6 22.6 56 26.6C54.8 29.4 51.8 29 51.1 25.4C50.4 21.2 49.4 16.8 51.5 15.5Z" fill={c.shade} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
            {/* Topknot, behind the skull for the same reason as the body's curls — the hair on the
                skull and nothing else, so it stays a cap up there rather than fluff over the dog. */}
            {[[38.4, 13.4], [44.5, 9.6], [50.6, 13.4]].map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="5.6" fill={c.coat} stroke={strokeColor} strokeWidth="2" />
            ))}
            {/* Skull, set low enough to meet the shoulders — floated clear of the body it read as a
                pom balanced on a dog rather than the dog's own head. */}
            <circle cx="44.5" cy="23" r="11" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Long straight muzzle, clipped bare. At chip size this is the single clearest thing
                separating a poodle from the other two — the old short stub read as a bear. */}
            <path d="M47 24.5C53 23.4 58.6 25 61 27.6C62.2 29 61 31.4 57.6 32.2C52 33.4 48 31 46.6 28.4Z" fill={c.shade} stroke={strokeColor} strokeWidth="2.2" strokeLinejoin="round" />
            <circle cx="59.6" cy="28.2" r="2.9" fill={c.dark} />
            {/* Near ear: long and flat, hanging close to the head as the standard asks */}
            <path d="M36.5 17.5C31.2 19.4 30.2 27.6 32.8 33.6C34.8 38.6 40 37.8 41 32.4C42.2 25.8 42 19.4 36.5 17.5Z" fill={c.shade} stroke={strokeColor} strokeWidth="2.2" strokeLinejoin="round" />
            {eyes(42, 50, 21)}
          </>
        );

      // 柴犬 — sturdy, with the three marks the breed is recognised by: cream mask/chest, sharp
      // triangular prick ears and a tail curled over the back.
      default:
        return (
          <>
            {/* Tail curled over the back. Drawn as a fat outline stroke with the coat laid back
                over it, so the curl keeps an even weight round the loop — a filled crescent at
                this size collapsed into a blob. */}
            <path d="M16 30C7.5 27.6 8 14.5 17 14.5C23 14.5 24.6 22.6 18.8 24.8" fill="none" stroke={strokeColor} strokeWidth="8.6" strokeLinecap="round" />
            <path d="M16 30C7.5 27.6 8 14.5 17 14.5C23 14.5 24.6 22.6 18.8 24.8" fill="none" stroke={c.coat} strokeWidth="5.2" strokeLinecap="round" />
            {/* Urajiro carries on under the tail */}
            <circle cx="18.8" cy="24.8" r="2.6" fill={c.accent} stroke={strokeColor} strokeWidth="1.5" />
            {legs({ backX: 19, frontX: 40, offset: -5, nearW: 7, farW: 6, top: 37 })}
            {/* Cream from the hock down — urajiro runs onto the legs too */}
            <rect x="19.6" y="47" width="5.8" height="8" rx="2.9" fill={c.accent} />
            <rect x="40.6" y="47" width="5.8" height="8" rx="2.9" fill={c.accent} />
            {/* Deep chest, behind the body so only what hangs below it shows. Without it the
                forelegs stood a good third longer than the hind pair, the body being an ellipse. */}
            <ellipse cx="41" cy="36" rx="7.6" ry="11.6" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Sturdy body */}
            <ellipse cx="27.5" cy="35.5" rx="17" ry="12" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Urajiro. The standard asks for a clean line where cream meets red rather than a
                blend, so this is a hard-edged underside sweeping up into the chest, not a soft
                wash — and it stays inside the body's outline so it reads as the dog's own belly. */}
            <ellipse cx="28" cy="41.5" rx="13" ry="5.2" fill={c.accent} />
            <ellipse cx="42" cy="39" rx="5" ry="7" fill={c.accent} />
            {/* Triangular prick ears, tilted slightly forward as the standard asks. Thick-based
                rather than tall and splayed: splayed ones read as a fox every time, which is the
                one animal this breed must not be mistaken for. Big, though — on a skull this size
                the old pair were nicks in the outline, and the ears are half of what makes a shiba
                a shiba at chip size. */}
            <path d="M34.6 14.5L38 1.5L45.6 9.6Z" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M47.6 9L57 1.6L58.4 15.6Z" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Urajiro reaches inside the ears too */}
            <path d="M37.6 12.4L39.2 5.6L43 9.4Z" fill={c.accent} opacity="0.9" />
            <path d="M50 10.4L55.4 6.2L56.2 14.2Z" fill={c.accent} opacity="0.9" />
            {/* Head */}
            <circle cx="45" cy="21" r="13" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Urajiro on the face: cheeks, jaw and either side of the nose */}
            <path d="M33.8 23q11.2 10 22.4 0q-2.4 10-11.2 10t-11.2-10Z" fill={c.accent} />
            {/* Short broad muzzle */}
            <ellipse cx="50" cy="27.6" rx="8" ry="5.8" fill={c.accent} stroke={strokeColor} strokeWidth="2.2" />
            <ellipse cx="55.2" cy="25.4" rx="3" ry="2.5" fill={strokeColor} />
            {/* The shiba smile */}
            <path d="M48.2 28.8q2.3 3.2 4.6 0" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.75" />
            {eyes(39.5, 50.5, 18.5)}
          </>
        );
    }
  })();

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {art}
    </svg>
  );
}

/**
 * How a cat is holding its eyes. The pose and the look have to agree — a cat mid-stalk with the
 * same wide shop-window eyes as a cat dozing on its haunches reads as the same drawing recoloured,
 * which is exactly what these three used to be.
 */
type CatGaze = 'open' | 'happy' | 'narrow';

/**
 * One leg, as the same capsule {@link PetLegs} draws, but between any two points so a pose can
 * lift a paw or push a hind leg back. Outline first with the coat laid over it, the same way the
 * tails are built, so a leg meeting the body at an angle still has no seam.
 *
 * Far legs pass `fill={c.shade}` on the thinner 1.8 outline; near legs take the coat and the
 * icon's own stroke width. That is the one depth cue every pet here shares.
 */
function CatLimb({
  x1, y1, x2, y2, w, fill, strokeColor, outline,
}: {
  x1: number; y1: number; x2: number; y2: number;
  w: number; fill: string; strokeColor: string; outline: number;
}) {
  const d = `M${x1} ${y1}L${x2} ${y2}`;
  return (
    <>
      <path d={d} fill="none" stroke={strokeColor} strokeWidth={w + outline} strokeLinecap="round" />
      <path d={d} fill="none" stroke={fill} strokeWidth={w} strokeLinecap="round" />
    </>
  );
}

/**
 * The cat face — ears, skull, markings, muzzle and whiskers — drawn once at a canonical centre of
 * (43, 24) and moved into place by each pose.
 *
 * A pose therefore only ever says *where the head goes and how it is tilted*, never how it is
 * drawn: three cats in three poses still share one face, which is what keeps them a set. The tilt
 * rotates about that same centre, so a head can lean without any of its parts sliding off it.
 */
/**
 * How much of its authored size the head is drawn at.
 *
 * The face below is built on a skull ~22 across, which on a 64 tile put the head at nearly half the
 * animal's total height — over the 35–42% a Q-version head can take before the body stops being an
 * animal and becomes a stand for the face. Scaling the whole group (rather than re-numbering thirty
 * coordinates) keeps every feature in its authored relationship and lands all three cats between
 * 36% and 41% of ear-tip-to-ground.
 *
 * The scale takes the strokes with it, so the head's own outline would come out thinner than the
 * body's — the callers pass a stroke width pre-divided by this to cancel that out.
 */
const CAT_HEAD_SCALE = 0.84;

function CatHead({
  c, isTuxedo, strokeColor, strokeWidth, x, y, tilt = 0, gaze = 'open',
}: PetPartProps & { isTuxedo: boolean; x: number; y: number; tilt?: number; gaze?: CatGaze }) {
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${tilt}) scale(${CAT_HEAD_SCALE}) translate(-43 -24)`}>
      {/* Ears: big, wide-set triangles. A cat's are taller and further apart than any dog's here,
          and drawn behind the head so their bases vanish into the skull.
          The RIGHT one is the far ear (see the 3/4 note above): shorter, narrower, and its base
          rolled a little further round the skull, which is what an ear on the far side of a turned
          head does. Drawn first so the near ear overlaps it, not the other way about. */}
      <path d="M45.4 12.4L51.2 8.2L53.4 16.4Z" fill={c.shade} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M31.8 17.2L34.6 6.6L42 11.8Z" fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M34.4 14.6L35.9 9.4L39.4 11.8Z" fill={c.accent} opacity="0.75" />
      <path d="M47.4 12.4L50.6 10L51.8 14.8Z" fill={c.accent} opacity="0.6" />
      {/* Skull. Not a circle any more: a cat's head is deeper through the cheeks than it is round,
          and — turned to the right — the near cheek carries further out than the far one. The
          silhouette still reads as the same round Q-version head at chip size. */}
      <path
        d="M43 12.6C49.4 12.6 54 17 54 23.2C54 29.6 49.2 34.6 42.6 34.6C36 34.6 32 30 32 23.4C32 17 36.6 12.6 43 12.6Z"
        fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
      />
      {/* Face pattern. Both tabbies wear the forehead M every tabby has plus the stripes running
          back from the eyes; the tuxedo wears the blaze up the bridge of its nose instead.
          Swung right with the rest of the face — a forehead M centred on a turned skull is the
          give-away that the markings were drawn flat-on and the muzzle in profile. */}
      {isTuxedo ? (
        <path d="M45.6 13.8C47.6 16.8 48.2 20.8 47.6 24.6C47.2 27.8 44 28.2 43 25.2C41.8 21.6 43 16.8 45.6 13.8Z" fill={c.accent} />
      ) : (
        <>
          <path d="M40.4 15.4l1.8 3M44.2 14.4l0.4 3.2M47.8 15.8l-1.4 2.8" stroke={c.shade} strokeWidth="1.7" strokeLinecap="round" fill="none" />
          <path d="M35 21.6h3.2M35.4 25h3" stroke={c.shade} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {/* Muzzle: two small cheek pads under a triangular nose — short and round, where every dog
          here has a snout that projects. The pads are the clearest read on the head's direction, so
          they are the part that must not be a symmetric pair: the far (right) pad is smaller, set
          a touch higher, and tucked behind the near one, the way the far side of any muzzle sits. */}
      <ellipse cx="50.4" cy="29" rx="3" ry="2.4" fill={c.accent} stroke={strokeColor} strokeWidth="1.6" />
      <ellipse cx="45.4" cy="29.9" rx="3.7" ry="3" fill={c.accent} stroke={strokeColor} strokeWidth="1.6" />
      {/* Nose, sat on the near pad's side of the midline for the same reason */}
      <path d="M46.2 26h4L48 28.6Z" fill={strokeColor} stroke={strokeColor} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M48 28.6v1.4" stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" />
      {/* Whiskers. White on the tuxedo — almost every one of them has white whiskers against the
          black, and here it is also the only way they stay visible at all on a near-black head.
          The far set is shorter and flatter: they are the same whiskers going away from the eye. */}
      <path d="M41 28.4l-7-1.6M41 30.6l-6.8 1.4"
            stroke={isTuxedo ? c.accent : strokeColor} strokeWidth="1.1" strokeLinecap="round" opacity={isTuxedo ? 0.9 : 0.55} />
      <path d="M53.6 27.8l5 -1.4M53.6 29.8l4.8 1.2"
            stroke={isTuxedo ? c.accent : strokeColor} strokeWidth="1" strokeLinecap="round" opacity={isTuxedo ? 0.75 : 0.45} />

      {/* The eyes are the only part of the face a pose changes. 開 for the alert tuxedo, 瞇 for
          the ginger's contented squint, 半瞇 for the tabby sizing you up. In all three the far eye
          is the smaller and the more crowded against the skull's edge — see PetEyes' `rFar`. */}
      {gaze === 'open' && <PetEyes leftX={39.8} rightX={48.8} y={21.5} strokeColor={strokeColor} rFar={1.6} />}
      {gaze === 'happy' && (
        <>
          <path d="M37.9 22.6q1.9-3 3.8 0" fill="none" stroke={strokeColor} strokeWidth="1.9" strokeLinecap="round" />
          <path d="M47.2 22.4q1.6-2.5 3.2 0" fill="none" stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {gaze === 'narrow' && (
        <>
          <ellipse cx="39.8" cy="22" rx="2" ry="1.25" fill={strokeColor} />
          <ellipse cx="48.8" cy="22" rx="1.7" ry="1.1" fill={strokeColor} />
          <path
            d="M37.6 19.6q2.2-1.4 4.4 0M46.9 19.8q1.9-1.2 3.8 0"
            fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round"
          />
        </>
      )}
    </g>
  );
}

/**
 * 寵物 — 貓. Every `pet-cat-*` id resolves here, keyed by the suffix, exactly as DogIcon handles
 * the dogs — same viewBox, same ground line, same leg capsules and the same face, so a cat and a
 * dog sitting next to each other in the 更衣室 rack read as one set rather than two people's
 * drawings.
 *
 * What separates a cat from a dog here is structural, not decorative: big triangular ears set
 * wide, a small round muzzle with a triangular nose and whiskers, and one long smooth tail instead
 * of the dogs' curl, sweep or pom.
 *
 * **What separates the three cats is the pose, not just the coat.** They started as one drawing
 * recoloured three times, which is what a shelf of identical standing silhouettes looks like:
 * three of the same cat. Each now stands in the attitude its own description already claimed —
 * the ginger sitting fat and pleased with its tail wrapped round its paws, the tabby low in a
 * stalk with a paw off the ground and its eyes narrowed at you, the tuxedo sitting up in its dinner
 * jacket with one white glove raised. The coat pattern still does the identifying at chip size;
 * the pose is what makes them read as three different animals at card size.
 *
 * Every piece that meets the body is stacked behind it (legs, chest, ears), so the animal has no
 * seam anywhere: a part laid on top keeps its own closed outline and reads as glued on. The one
 * deliberate exception is a pose's *foreground* limb — the ginger's wrapped tail, the tabby's
 * stepping paw, the tuxedo's raised glove — which is in front because that is where the cat's own
 * anatomy puts it.
 */
function CatIcon({
  breed, size, className, strokeColor, strokeWidth,
}: {
  breed: string;
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  const c = PET_SPECS[breed] ?? PET_SPECS.tabby;
  const isTuxedo = breed === 'tuxedo';
  const sw = Number(strokeWidth);

  const head = (x: number, y: number, tilt: number, gaze: CatGaze) => (
    // Stroke pre-divided by the head's own scale, so the outline round the skull comes out at
    // exactly the icon's weight rather than 16% lighter than the body it sits on.
    <CatHead c={c} isTuxedo={isTuxedo} strokeColor={strokeColor} strokeWidth={(sw / CAT_HEAD_SCALE).toFixed(2)}
             x={x} y={y} tilt={tilt} gaze={gaze} />
  );
  const nearLeg = (x1: number, y1: number, x2: number, y2: number) => (
    <CatLimb x1={x1} y1={y1} x2={x2} y2={y2} w={5.2} fill={c.coat} strokeColor={strokeColor} outline={sw} />
  );
  const farLeg = (x1: number, y1: number, x2: number, y2: number) => (
    <CatLimb x1={x1} y1={y1} x2={x2} y2={y2} w={4.4} fill={c.shade} strokeColor={strokeColor} outline={1.8} />
  );
  /**
   * The neck, as one mass bridging the back of the skull to the withers.
   *
   * Stacked BEHIND both the head and the body, so all that shows of it is the arc between the two —
   * which is the whole job. Without it the head is a disc laid on a torso and the animal has a
   * hinge where its neck should be; a drawn-in neck instead gives the one continuous line the
   * silhouette needs, 額頭 → 後腦 → 短頸 → 肩胛 → 背.
   *
   * A cat's neck is SHORT and as thick as its skull, so this is a wide mass rather than a stalk:
   * anything narrow enough to read as a neck on its own is already too thin to be one.
   */
  const neck = (cx: number, cy: number, rx: number, ry: number, rot: number) => (
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`}
             fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
  );
  /**
   * A haunch — the folded hind leg of a sitting cat, or the thigh of a standing one.
   *
   * Its top half is buried in the body on purpose: a thigh has to grow out of the pelvis, and one
   * drawn clear of the torso is a disc parked beside a cat. What shows is the lower, forward part,
   * which is exactly the part of a real haunch you see.
   */
  const haunch = (cx: number, cy: number, rx: number, ry: number, rot: number) => (
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`}
             fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} />
  );
  /**
   * The tail, in chained segments that get thinner toward the tip.
   *
   * One stroke of constant width is a piece of rope, and reads as one whether it comes off the
   * pelvis or the middle of the back. A tail is thick where it leaves the croup — it is the last of
   * the spine — and fine at the end, and that taper is most of what makes it look attached. Every
   * outline is laid down before any of the coat, so the join between two segments has no seam.
   */
  const tail = (...segs: string[]) => (
    <>
      {segs.map((d, i) => (
        <path key={`o${i}`} d={d} fill="none" stroke={strokeColor} strokeWidth={7.4 - i * 1.7} strokeLinecap="round" />
      ))}
      {segs.map((d, i) => (
        <path key={`c${i}`} d={d} fill="none" stroke={c.coat} strokeWidth={4.6 - i * 1.35} strokeLinecap="round" />
      ))}
    </>
  );
  /** A mackerel bar. Same weight everywhere, so a stripe is a stripe on any of them. */
  const bar = (d: string) => (
    <path key={d} d={d} fill="none" stroke={c.shade} strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
  );

  const art = (() => {
    switch (breed) {
      // 橘貓 — sitting, round and pleased with itself, tail curled round the front paws and eyes
      // shut in a squint. The one cat whose own description says its weight has never worried it,
      // so it gets the pose that shows the most cat per square inch.
      case 'orange':
        return (
          <>
            {/* Far foreleg, planted under the far shoulder */}
            {farLeg(35, 42.8, 35, 52.6)}
            {/* Neck, bridging the back of the skull to the withers — see `neck` above */}
            {neck(35.4, 28.4, 8, 6.4, -22)}
            {/* Seated body. Four things this outline has to state, going clockwise from the
                withers: a chest with some depth to it (the bulge down the right), a belly drawn
                back in under it, a waist that is narrower than what is below, and a wide round
                pelvis sitting flat on the ground. The old egg had none of them — one radius from
                shoulder to floor, which is a bag rather than a cat. */}
            <path
              d="M31.4 26.6
                 C38.4 27.4 41.6 33.4 42 40.2
                 C42.3 45.2 41 49.6 38 52.4
                 C35.4 54.4 30.8 54.6 26.2 54.4
                 C20.6 54.1 16.9 51.4 16.7 46
                 C16.5 41 18.2 36 20.8 32.2
                 C23 29 26.8 26.2 31.4 26.6Z"
              fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* Pale front, running from the chin down between the forelegs */}
            <ellipse cx="37" cy="42.6" rx="4.8" ry="8.2" fill={c.accent} opacity="0.9" />
            {/* Bars over the back and flank, following the new spine rather than the old egg */}
            {[
              'M24.2 32.8q3 1.4 4.4 4.4',
              'M20.6 38.8q3.2 1.2 4.8 4',
              'M19.4 45.6q3.2 0.8 5 3.2',
            ].map(bar)}
            {/* The near haunch: the folded hind leg, growing out of the pelvis rather than sat
                beside it — its top half is inside the body, and what shows is the lower forward
                curve, which is the part of a real haunch a viewer sees. Together with the rump
                behind it and the far thigh under it, this is the sitting cat's tripod. */}
            {haunch(24.6, 46.4, 7.4, 6.4, -12)}
            {/* Hind paw, forward of the haunch and flat on the ground at the baseline */}
            <ellipse cx="31" cy="52.3" rx="3.6" ry="2.7" fill={c.accent} stroke={strokeColor} strokeWidth="1.6" />
            {/* Near foreleg, hanging from the shoulder down the front of the chest */}
            {nearLeg(38.6, 41.4, 38.6, 52.4)}
            {/* Tail wrapped round the front of the paws — drawn last of the body parts because that
                is where a sitting cat actually puts it: over its own feet, not behind them. It
                leaves from BEHIND the pelvis at the croup, thick, and tapers over the toes. */}
            {tail(
              'M17.4 47C13.2 47.6 11.2 51.6 14.4 53.4',
              'M14.4 53.4C19 55.6 27 55.2 33.6 53.8',
              'M33.6 53.8C38 52.9 41.2 51.4 43.6 49.2',
            )}
            {[[24.4, 54.4], [31, 53.9]].map(([x, y]) => (
              <path key={x} d={`M${x} ${y - 1.7}v3.4`} stroke={c.shade} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
            ))}
            {head(38.2, 20.2, -7, 'happy')}
          </>
        );

      // 賓士貓 — sitting up in the dinner jacket it was born wearing, one white glove raised. The
      // pose is chosen for what it shows: the bib down the front and a sock held up at eye level
      // are the two marks this cat is named for.
      case 'tuxedo':
        return (
          <>
            {/* Tail up behind, white tip. Swung well clear of the body: against a coat this dark
                an outline is worth nothing, so anything that overlaps the silhouette is simply
                lost — every part of this cat has to be read off its edge or off the white. */}
            {tail(
              'M18.6 47.6C13.8 47 11 43.8 10.6 39.4',
              'M10.6 39.4C10.3 36.2 11.6 33.6 14 32',
              'M14 32C14.4 31.7 14.9 31.5 15.4 31.4',
            )}
            <circle cx="15.4" cy="31.4" r="2" fill={c.accent} stroke={strokeColor} strokeWidth="1.3" />
            {/* Neck. Shorter and more upright than the ginger's, because this cat is sitting up
                rather than settling down — but the same continuous run from skull to shoulder. */}
            {neck(33.6, 27.4, 7.6, 6.2, -14)}
            {/* Seated body — taller and narrower than the ginger's, sat upright rather than
                slumped, and built on the same four landmarks: chest, tucked belly, waist, pelvis.
                The old outline was a near-straight column from shoulder to floor, which is the one
                shape a seated cat is not. */}
            <path
              d="M32.4 25.4
                 C39.4 26.6 42 33 42.3 39.8
                 C42.6 45.6 41.2 50.2 38 52.6
                 C35 54.6 30.2 54.8 25.6 54.5
                 C19.8 54.1 16.4 51 16.6 45.4
                 C16.8 39.4 19 33.4 22 29.8
                 C24.2 26.8 28 25 32.4 25.4Z"
              fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* The near haunch, out of the pelvis — same construction as the ginger's, and the
                other half of the seated base */}
            {haunch(24.8, 46.8, 7, 6.2, -12)}
            {/* The bib: one piece from the throat to the belly, the way the marking actually runs.
                Kept clear of both edges of the body — a bib run out to the outline would take the
                cat's whole middle with it and leave a white shape with ears. Follows the new chest
                and belly, so it narrows at the waist as the marking does. */}
            <path d="M33 30C36.8 32.6 38.8 38.4 39.1 44.8C39.4 50.2 36.9 54 32.9 54.4C29.2 54.8 27.4 51.4 27.2 46C27 38.8 30 31.4 33 30Z" fill={c.accent} />
            {/* White hind paw, forward of the haunch and on the baseline */}
            <ellipse cx="30.6" cy="52.6" rx="3.2" ry="2.5" fill={c.accent} stroke={strokeColor} strokeWidth="1.6" />
            {/* The planted foreleg in its white sock, drawn in FRONT of the body: on a seated cat
                the forelegs hang down the chest, so behind it they would simply not exist. */}
            {nearLeg(38.8, 41.6, 38.8, 52.4)}
            <rect x="36.9" y="49.4" width="3.8" height="5" rx="1.9" fill={c.accent} />
            {/* The other foreleg, held up with the glove on the end. It leaves the SAME shoulder
                the planted one does — both forelegs on a cat hang off the same chest, and the old
                pair started 0.8 apart at completely different heights, which is two legs sprouting
                from the ribs. It reaches past the body's edge on purpose: the half that overlaps
                the coat is invisible anyway, and what sells the gesture is the part out in the
                open. */}
            {nearLeg(38.4, 40.6, 45.4, 35.6)}
            <circle cx="45.8" cy="35" r="2.8" fill={c.accent} stroke={strokeColor} strokeWidth="1.6" />
            {head(36.4, 19.4, 6, 'open')}
          </>
        );

      // 虎斑貓 — mid-stalk: body low and long, hind leg pushed back, one forepaw off the ground and
      // the tail streaming out behind. Its description says it looks at everyone like it is sizing
      // them up, so it gets the half-lidded eyes to go with the walk.
      default:
        return (
          <>
            {/* Tail low and level with a flick at the end — a stalking cat does not carry it up.
                Off the croup, behind the pelvis, and thick where it leaves it. */}
            {tail(
              'M14.4 38.8C10.8 40.2 7.4 39.4 5.6 36.2',
              'M5.6 36.2C4.2 33.6 4.2 30.8 5.4 28.2',
              'M5.4 28.2C5.6 27.7 5.9 27.3 6.2 26.9',
            )}
            {[['M9.8 38v4'], ['M3 32h4.2']].map(([d]) => (
              <path key={d} d={d} stroke={c.shade} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            ))}
            {/* Far pair. The hind one drops from under the pelvis, the fore one from under the
                chest — the two places a leg can come from on a standing cat. */}
            {farLeg(17.8, 41.6, 17.4, 52.6)}
            {farLeg(35.4, 40, 35, 52.6)}
            {/* Near hind: a thigh out of the pelvis, then a shank angled forward to the paw. Two
                pieces rather than one stick, because that bend at the stifle is the whole reason a
                hind leg looks like a hind leg and not like a fore one moved backwards. */}
            {haunch(19.8, 41.4, 6.4, 5.8, -8)}
            {nearLeg(20.8, 44.8, 22.8, 52.4)}
            {/* Neck, carrying the head out in front of the shoulders as a stalk does */}
            {neck(37.2, 31, 7, 5.4, -32)}
            {/* Body — long and low, which is the stalk. Same four landmarks as the seated pair,
                laid on their side: deep chest at the front, belly tucked up under the waist, and a
                round pelvis at the back for the hind leg to come out of. The old drawing was one
                horizontal ellipse with four sticks in it, so every leg started at the middle of the
                belly and the cat had neither shoulder nor hip. */}
            <path
              d="M36.6 31.6
                 C39 33 40.2 34.6 40 36.8
                 C39.8 39.8 39.4 42 38.2 43.6
                 C35 44.8 31.6 44.2 28.4 42.8
                 C25.6 44.8 23.2 46 20.4 45.8
                 C16.4 45.5 13.4 43.6 13.6 39.8
                 C13.8 35.2 14.6 31.8 17.2 30
                 C21.8 26.8 30.4 27.6 36.6 31.6Z"
              fill={c.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* Pale underside, along the tucked belly and kept inside the outline */}
            <ellipse cx="27" cy="41.8" rx="7.6" ry="2" transform="rotate(-3 27 41.8)" fill={c.accent} opacity="0.9" />
            {[
              'M19.6 32.4q1.7 4 0.6 7.6',
              'M25.4 31.2q1.9 4.6 0.6 8.8',
              'M31.2 32.2q1.8 4.2 0.6 8',
            ].map(bar)}
            {/* Near foreleg, mid-step and well off the ground: the whole reason this reads as
                walking rather than standing. It leaves the shoulder at the front of the chest and
                stops short of the 55 baseline — the gap under the paw is doing all the work, and
                brought any lower it just looks planted. Drawn over the body because a stepping
                foreleg is the nearest thing to the viewer. */}
            {nearLeg(37.8, 38.8, 42.8, 44.8)}
            {head(44.2, 24.6, 4, 'narrow')}
          </>
        );
    }
  })();

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {art}
    </svg>
  );
}

/**
 * 寵物 — 鳥. Every `pet-bird-*` id resolves here, on the same tile as the 狗 and 貓: one 64 viewBox,
 * the same ground line at {@link LEG_BASELINE}, the same outline weight and the same two-dot face,
 * so a parrot on the shelf beside a shiba still reads as one shop rather than two.
 *
 * **Drawn from the wild/classic plumage of each, checked against reference rather than invented.**
 * That matters more here than it did for the mammals: 臘腸 vs 柴犬 is a silhouette anyone can
 * picture, but a bird is identified almost entirely by its markings, and a 虎皮鸚鵡 without its
 * barring or a 文鳥 without its white cheeks is just a generic bird in the right colour. So each of
 * the three is built around the two or three marks it is actually named and known by:
 *
 *   虎皮鸚鵡 — the black-and-yellow barring over crown, nape and wing (the 虎皮 the name is for),
 *              violet cheek patches, a row of black throat spots, and the long cobalt tail.
 *   文鳥     — the black hood with two big white cheek patches, the fat red bill and the red eye
 *              ring that matches it, grey above and pink below.
 *   金絲雀   — canary yellow all over with a warmer orange face and breast, a small pale conical
 *              bill held open, because what this bird is bought for is the singing.
 *   鳳凰     — the exception to the paragraph above, and the only one here drawn from nothing:
 *              a flame crest, a fan of three curved plumes and gold on the wing and face. What it
 *              has to be identified as is a KIND of bird rather than a species of one, so it is
 *              built from the three marks the idea of a phoenix carries rather than from reference.
 *
 * A bird's whole body plan differs from a mammal's, so unlike the cats these do not share one
 * build; what they DO share are the two parts every bird has and no mammal does — the legs and the
 * bill — which is why those are helpers here rather than four sets of numbers.
 *
 * Two eyes, front-facing, on all four. A real perching bird's eyes are on the sides of its skull
 * and a strict drawing would show one and a sliver, but that is the single strongest thing tying
 * these tiles to the 狗/貓 tiles beside them, and a one-eyed bird on a shelf of two-eyed pets reads
 * as a different artist rather than as better anatomy.
 */
function BirdIcon({
  breed, size, className, strokeColor, strokeWidth,
}: {
  breed: string;
  size: number;
  className: string;
  strokeColor: string;
  strokeWidth: string;
}) {
  const c = PET_SPECS[breed] ?? PET_SPECS.budgie;
  /**
   * The two 鳥-only slots of {@link PetSpec}, resolved once with a fallback so a bird added to
   * PET_SPECS without them draws in its own colours rather than in unfilled black.
   */
  const keratin = c.beak ?? c.shade;
  const mark = c.mark ?? c.accent;

  /**
   * ─── The shared skeleton ────────────────────────────────────────────────────────────────────
   *
   * All four birds are drawn on ONE body, and the body is drawn as ONE outline. Both halves of
   * that sentence are the anatomy pass, and each fixes a fault the four tiles shared.
   *
   * **One outline, not a head on a body.** Every bird here used to be a head CIRCLE stacked over a
   * body ELLIPSE. Two closed shapes that overlap do not read as one animal however far they are
   * pushed together: where their outlines cross they cut a notch into each other, and a notch on
   * both sides of a skull is a neck. Shrinking the gap only ever moved the fault — the head still
   * sat ON the bird rather than being part of it. So the skull's arc and the torso's curves are now
   * segments of a SINGLE path ({@link BODY_D}): from the nape the outline runs up over the crown,
   * round the face, down the throat, out over the breast, under the belly, round the rump and back
   * up the back to where it started. There is no seam to hide because nothing crosses anything.
   * Birds whose head is a different colour from their coat paint it with {@link headPatch}, which
   * re-uses the same arc and closes it with the colour boundary alone — one contour, never two.
   *
   * **r 8.2, down from 11.** 11 was chosen to match the cats' skull exactly, on the argument that a
   * shelf is harmonised by a shared caricature rather than a shared ruler. That argument is still
   * right and this is still a big cartoon head — but at 11 the head was 49% of the bird's drawn
   * height, and past about 40% a head stops reading as a big head and starts reading as a head
   * belonging to a different, larger animal, which is where the "頭身分離" came from. 8.2 puts it at
   * 38% of crown-to-toe, the top of the band a chibi head can hold, and the difference goes into
   * the chest and belly rather than into empty tile.
   */
  const HEAD_R = 8.2;
  const HEAD_X = 42.4;
  const HEAD_Y = 20.4;

  /**
   * The two points where the skull's arc hands over to the torso: the NAPE, at the back of the
   * skull where the outline is falling vertically, and the THROAT, under the jaw.
   *
   * The nape is at the head's widest point on purpose. There the circle's own edge is vertical, so
   * a back that drops away vertically leaves it without a corner — which is the whole trick to
   * "後腦至背部平順銜接". The throat cannot be tangent in the same way (a breast that bulges forward
   * under a round jaw has to turn a corner somewhere, on a real bird too), so instead the first
   * control point below leans BACK along the skull before the curve turns forward: what the eye
   * gets is a soft concave throat, not a chin dropped onto a chest.
   */
  const NAPE = '34.3 21.8';
  const THROAT = '47.1 27.1';

  /** Nape → crown → face → throat, as a real circular arc so the skull stays a true circle. */
  const HEAD_ARC = `M${NAPE}A${HEAD_R} ${HEAD_R} 0 1 1 ${THROAT}`;

  /**
   * The whole bird's silhouette: skull arc, then throat, breast, belly, rump and back.
   *
   * A teardrop lying on its side with the point at the rump — chest forward and low, belly full and
   * dropping to just above the ground line, the back收束ing into the tail root. Widest across the
   * shoulders (x 33 to 48, against a 16.4-wide skull), so there is no waist under the jaw for a
   * neck to read into.
   */
  const BODY_D =
    HEAD_ARC +
    // Throat → breast. The first control leans back into the jaw (see NAPE/THROAT above).
    'C45.6 28.2 48.6 33 48.4 38.4' +
    // Breast → belly floor, kept clear of the ground line so the legs have somewhere to show.
    'C48.2 44.2 43.2 48.8 37.2 49.8' +
    // Belly → vent, rolling under rather than cutting across: this is the underside, not a base.
    'C31.4 50.8 25 49.4 22.4 45.8' +
    // Rump → up the back. The tail roots inside here and the wing tip lands just short of it.
    'C19.8 42.4 19.6 36 22.4 30.4' +
    // Back → nape, arriving all but vertical so the skull continues it (see NAPE).
    'C24.6 26 33 26.2 34.3 21.8' +
    'Z';

  /** The silhouette, filled in the coat and carrying the ONE outline the whole bird gets. */
  const bodySilhouette = (fill: string) => (
    <path d={BODY_D} fill={fill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
  );

  /**
   * A head in a colour the body is not — the 虎皮鸚鵡's yellow mask, the 文鳥's black hood.
   *
   * `boundary` runs from the THROAT back to the NAPE and is the only edge drawn: the arc it closes
   * against is the silhouette's own, already stroked once. Struck at 1.5 rather than the body's
   * weight because it is a colour boundary inside an animal, not the edge of one — at full weight
   * it becomes the second contour this pass exists to remove.
   */
  const headPatch = (boundary: string, fill: string) => (
    <>
      <path d={`${HEAD_ARC}${boundary}Z`} fill={fill} />
      <path d={boundary} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
    </>
  );
  /**
   * Where the eyes sit on it, as one rule for all four.
   *
   * `SPAN` is 0.75r against the cats' 0.82r, and the 0.07 is bought by the one thing no cat has: a
   * bill projecting from the front of the skull. At the cats' spacing the far eye's edge lands on
   * the 金絲雀's open mandible and inside the 虎皮鸚鵡's cere, and the fix of pushing the bill
   * further out runs it off the tile. 0.75r is as wide as a bird's face can carry and is still far
   * closer to the cats than any of the four was.
   *
   * `RISE` is 2.5 — the cats' number unchanged — so the forehead is the same fraction of the skull
   * on every animal in the shop. `LEAD` nudges the pair toward the bill, because a head this round
   * is only readable as turned if the features sit off its centre.
   */
  const EYE_SPAN = HEAD_R * 0.75;
  const EYE_RISE = 2.1;
  const EYE_LEAD = 0.4;

  /**
   * The pair, on the one skull all four now share, so this takes no arguments at all: eye size,
   * spacing and height are identical on every bird in the set by construction rather than by four
   * call sites agreeing.
   */
  const headEyes = () => (
    <PetEyes
      leftX={HEAD_X + EYE_LEAD - EYE_SPAN / 2}
      rightX={HEAD_X + EYE_LEAD + EYE_SPAN / 2}
      y={HEAD_Y - EYE_RISE}
      strokeColor={strokeColor}
    />
  );

  /**
   * One leg: a bare tarsus with three toes on the ground, two forward and one back, as every
   * perching bird has them.
   *
   * Outline first, colour laid over it — the same construction as the cats' limbs and every tail
   * in this file, so a leg meeting the body has no seam. `far` is the depth cue: the mammals shade
   * their far pair with `c.shade`, but a leg is bare keratin rather than coat and has no shade of
   * its own, so it drops in opacity instead of changing colour.
   */
  const leg = (x: number, hipY: number, far = false) => {
    const toes = `M${x} 52l4.6 2.6M${x} 52l1.4 3.4M${x} 52l-4 2.8`;
    return (
      <g opacity={far ? 0.62 : 1}>
        <path d={`M${x} ${hipY}V52.4`} stroke={strokeColor} strokeWidth={far ? 4.4 : 5.4} strokeLinecap="round" />
        <path d={toes} fill="none" stroke={strokeColor} strokeWidth={far ? 3.2 : 4} strokeLinecap="round" />
        <path d={`M${x} ${hipY}V52.4`} stroke={keratin} strokeWidth={far ? 2.2 : 3} strokeLinecap="round" />
        <path d={toes} fill="none" stroke={keratin} strokeWidth={far ? 1.6 : 2.1} strokeLinecap="round" />
      </g>
    );
  };

  /**
   * The tail, as a tapered blade swept back and down off the rump.
   *
   * **The taper has to happen where the tail is actually visible**, which is the lesson of two
   * failed passes. Most of a tail's base is behind the body, so a shape that narrows evenly from
   * root to tip is still nearly parallel-sided by the time it clears the flank, and what shows is
   * a plank stuck out of the bird's side. These converge almost to a point over the outer half
   * instead, and read as feathers at the cost of being geometrically wrong at the root nobody sees.
   *
   * `spine` is the single line down the middle: it stops a broad blade reading as a paddle, and on
   * the canary it doubles as the fork of its notched tail.
   */
  const tailBlade = (d: string, fill: string, spine: string) => (
    <>
      <path d={d} fill={fill} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      <path d={spine} fill="none" stroke={strokeColor} strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    </>
  );

  /**
   * The folded wing, laid ON the body rather than behind it.
   *
   * That is the one deliberate break from this file's stacking rule, for the same reason the cats'
   * foreground paw is: a bird's folded wing genuinely lies on top of its flank, and tucked behind
   * the body it would show as a fringe along the edge and nothing else. On these three the wing is
   * also where the plumage is — the budgie's whole barred panel is on it.
   *
   * **Outlined on only three sides.** `d` is the filled shape and `edge` is the shoulder, front and
   * bottom of it as an open stroke; the top-back, where the wing folds into the bird, is left
   * unstroked. Closed all the way round — which is what the first pass did — the wing kept its own
   * complete outline and read as a patch sewn onto the body rather than as part of it. Every other
   * animal in this file gets the same effect by stacking the piece behind the body, which a wing
   * cannot use because a wing is in front.
   */
  const wing = (d: string, edge: string, fill: string) => (
    <>
      <path d={d} fill={fill} />
      <path d={edge} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );

  /**
   * The folded wing, and the same one on all four.
   *
   * A leaf rooted at the SHOULDER — just under the nape, where a wing is actually hinged — sweeping
   * down the flank and closing to a point at the rump. Both ends of that sentence were wrong before:
   * the old wing was an ellipse whose root sat halfway down the belly, so it read as a patch stuck
   * on the side of the bird rather than as the limb it is, and it ended bluntly in the middle of the
   * flank instead of tapering into the tail root.
   *
   * The shape is deliberately narrow at both ends and full in the middle, which is what a folded
   * wing is: the coverts bunch at the shoulder, the primaries close to a point over the tail.
   */
  const WING_D =
    'M36.4 28C41.2 31.6 41.4 39.6 36 44.8C32.2 48.4 26.4 48.6 24 45.4' +
    'C22.4 43.2 25.4 35 29.8 30.8C32.2 28.6 34.6 26.8 36.4 28Z';
  /** Shoulder, leading edge and underside only — the top-back folds into the bird (see {@link wing}). */
  const WING_EDGE = 'M36.4 28C41.2 31.6 41.4 39.6 36 44.8C32.2 48.4 26.4 48.6 24 45.4';

  /**
   * Both legs, on one line and at one set of numbers, because "四隻鳥腳掌畫法相同" is only true if
   * they are literally the same call. The near foot leads and the far one trails by 5.2 — enough to
   * read as two legs in perspective — and both land their toes on 52.4, the ground line the tile's
   * shadow is drawn under. The hips are buried at 45: the belly floor is at ~49.8, so what shows is
   * a short bare tarsus, which is what a small perching bird has.
   */
  const legs = (
    <>
      {leg(31.4, 45.4, true)}
      {leg(36.6, 45)}
    </>
  );

  const art = (() => {
    switch (breed) {
      // 鳳凰 — the one bird on this shelf drawn from mythology instead of from reference, and the
      // only one whose problem is the opposite of the other three's. Those are each identified by
      // two or three marks a real bird has; nobody has ever seen this one, so what has to be
      // legible is not a marking but a CATEGORY — "that is a phoenix, not a fancy chicken".
      //
      // Three things carry that, and they are the only three things this tile spends on:
      //
      //   1. **The crest**, a standing fan of flame-shaped feathers, growing from the CROWN and
      //      nowhere else. It is the single strongest read: everything else on the shelf has a
      //      smooth round skull, so a silhouette with something burning on its head is already not
      //      a pet-shop bird.
      //   2. **Three tail plumes**, all rooted behind the rump and sweeping UP into the corner this
      //      tile is otherwise empty in. The other three birds' tails drop toward the ground line,
      //      so rising plumes read as the exception before the shape is even resolved.
      //   3. **The gold edging**, on the wing coverts and along every plume. A phoenix painted in
      //      flat red is a red bird; the metal edge is what says the plumage is worth something.
      //
      // Crest, wing and plumes are the three things that used to run into each other — a thicket of
      // points along the whole back edge, all the same length and all pointing the same way. They
      // are now separated by ORIGIN (crown / shoulder / rump), by DIRECTION and by length, which is
      // what lets three sets of spikes on one small animal stay three things.
      case 'phoenix':
        return (
          <>
            {/* The plumes. NOT drawn with {@link tailBlade} — that helper makes a straight blade,
                which is right for the three real birds and wrong here twice over: three straight
                blades off one rump read as a bundle of planks, and a straight tail is the one thing
                this bird must not have. Every plume is CURVED, tapers to an actual point, and all
                three root at the SAME place behind the rump, fanning from nearly-vertical down to
                nearly-horizontal. Rooted together and spread at the tips they are a fan; rooted
                apart, which is what they used to be, they are three tails.
                They stop short of the tile edge on all three — a plume cut off flat by the viewBox
                is a plank again, however well it curves up to that point. */}
            {([
              {
                d: 'M24.2 38C17.4 34 11.6 27.4 10.4 19C15.8 28 21.6 34.2 27.6 39.6Z',
                shaft: 'M12 22.6C16.4 30 21.4 35.4 26.4 39.6',
              },
              {
                d: 'M23 41.4C15.8 40.2 9 37 4 32.8C11.2 39.8 18.4 43.6 26 45.4Z',
                shaft: 'M6.4 34.6C13 39.4 19.8 42.6 25.6 44.4',
              },
              {
                d: 'M23.4 44.2C16.4 44.8 9.8 47.4 4.6 51.4C11.4 53.2 18.6 51.8 26.4 47.8Z',
                shaft: 'M7.2 50C13.4 48 19.6 46.4 25.2 45',
              },
            ] as const).map(({ d, shaft }, i) => (
              <g key={d}>
                <path d={d} fill={[c.coat, mark, c.shade][i]} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
                <path d={shaft} fill="none" stroke={c.accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
              </g>
            ))}
            {/* The crest, drawn before the body so the feathers root INSIDE the skull rather than
                sitting on top of it like a hat. Three flames, the middle one tallest, each a leaf
                cut with one concave side — a symmetrical leaf reads as a petal and turns the bird
                into a flower. They lean back, the way anything on fire does. */}
            {([
              ['M39.6 13.8C36.8 10.2 35.4 6.8 35.8 4.2C38 6.2 40.4 9 41.4 12.2Z', c.coat],
              ['M42.6 12.4C41.8 7.6 42 4 43.4 1.6C44.6 4.4 45.4 8.2 45 12Z', mark],
              ['M45.8 13C46.6 9.4 48.2 6.4 50.4 4.6C50.2 7.8 49.2 11.2 47.6 14.2Z', c.coat],
            ] as const).map(([d, fill]) => (
              <path key={d} d={d} fill={fill} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            ))}
            {/* The nape ruff, the one shape on this bird that had to be drawn twice. It replaces two
                gold plumelets that streamed back off the skull and, at the size this is looked at,
                read as A SECOND BEAK on the back of the head — same gold, same size, same pointed
                wedge, attached to a round head. What fixes it is not making them smaller: a ruff
                must FOLLOW the skull instead of projecting away from it, and there must be several.
                One pointed thing on a head is a bill wherever it is put; three small rounded ones
                stepped around the same arc are plumage, because plumage is what repeats. */}
            {([
              [32.2, 23.6, 160, mark],
              [32, 18.2, 190, c.accent],
              [34.2, 13.6, 220, c.accent],
            ] as const).map(([x, y, angle, fill]) => (
              <ellipse
                key={angle}
                cx={x} cy={y} rx="3.2" ry="2.4"
                transform={`rotate(${angle} ${x} ${y})`}
                fill={fill}
                stroke={strokeColor}
                strokeWidth="1.5"
              />
            ))}
            {legs}
            {bodySilhouette(c.coat)}
            {/* The breast, in the hot orange between the body's red and the gold above it. A soft
                block over the chest, which is where this bird's warm colour belongs — it used to be
                three hard bars across the belly, and evenly spaced bars around a body is the
                segmentation of an insect, not the plumage of a bird. */}
            <ellipse cx="43.4" cy="34.4" rx="4.6" ry="6" transform="rotate(-18 43.4 34.4)" fill={mark} opacity="0.55" />
            {/* Wing in GOLD, not in the coat — the coverts are the metal on this bird, and a wing
                painted red on a red body leaves the flank with nothing on it at all */}
            {wing(WING_D, WING_EDGE, c.accent)}
            {/* One band of flight feathers across the wing, in the deep crimson. Across it, along
                the run of the feathers themselves, rather than down its length: bars that follow the
                body instead of the wing are what made the belly look segmented. */}
            {['M25.6 43.4C28 45.8 31.6 46.2 34.8 44.2', 'M25.2 39C27.6 41.2 31.2 41.6 34.4 39.8'].map(d => (
              <path key={d} d={d} fill="none" stroke={c.shade} strokeWidth="2.2" strokeLinecap="round" />
            ))}
            {/* The gold mask, the same metal as the wing. Cut as a wedge from the brow down to the
                bill rather than as a patch on the cheek — a round gold blob beside two round eyes is
                a third eye. The boundary runs just forward of the head's centre, so the near eye
                sits on red and the far one on gold: one mask, on a head that is turned. */}
            <path d="M46.2 13.4C48.8 14.4 50.1 16.4 50.3 19.4L47.4 26.2C45.9 25 45.3 22.6 45.7 19.8Z" fill={c.accent} opacity="0.92" />
            {/* Bill: a short raptor's hook, held closed, both mandibles off one base. Shorter and
                deeper than the parrot's on the same shelf and hooked harder — this is the one bird
                here that is not eating seed, and a phoenix with a finch's cone is a chicken.
                Both roots moved back to x≈49.3, INSIDE a skull that reaches 50.1 at this height.
                They used to start at 50.6–51, half a unit clear of the face, so the head's own
                outline ran between the skull and the bill and the bill read as a loose piece held up
                beside the head. A bill has to start under the face, not against it. */}
            <path d="M49.4 17.6C53.4 17.9 56.6 19.4 57.6 21.4L49.2 22.9Z" fill={keratin} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M49.2 22.9L57.6 21.4C56.8 24.6 54.6 27.4 52 28.2C50.6 26.4 49.6 24.6 49.2 22.9Z" fill={keratin} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M53.8 23.2C55.2 24.4 55.4 26.2 54.4 28" fill="none" stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
            {headEyes()}
          </>
        );

      // 文鳥 — the round one. Sat as a ball with the head hunched down into the shoulders, which is
      // how this bird actually holds itself and half of why it is kept: there is no neck to see.
      // On the shared body that hunch is free — it is what the silhouette already does — so what
      // this tile spends on is the three marks: black hood, white cheeks, red bill.
      case 'javasparrow':
        return (
          <>
            {/* Short stubby black tail — a finch's, nothing like the parrot's beside it. Rooted
                inside the rump and carrying the line of the back on out, rather than leaving the
                flank sideways. */}
            {tailBlade(
              'M24 40C19 43.6 14.4 47 11.4 49.6L13 51.4C17.6 49.2 22.4 46.6 26.6 44Z',
              c.dark,
              'M12.6 50.2C17 48 21.4 45.4 25.2 42.8',
            )}
            {legs}
            {bodySilhouette(c.coat)}
            {/* Pink belly, kept well inside the outline so it reads as this bird's underside rather
                than as a second shape stuck to the bottom of it */}
            <ellipse cx="33.8" cy="45" rx="8.4" ry="4.4" transform="rotate(-4 33.8 45)" fill={mark} />
            {wing(WING_D, WING_EDGE, c.shade)}
            {/* The black primaries along the wing's trailing edge. Dark, because the wing is barely
                a shade off the back it sits on — which is true of the bird — so without something
                with real contrast on it the whole flank goes flat. */}
            <path d="M25.2 44.6C27.6 46.8 31.2 47.2 34.4 45.4" fill="none" stroke={c.dark} strokeWidth="3" strokeLinecap="round" />
            <path d="M25 40.6C27.2 42.6 30.4 43 33.2 41.6" fill="none" stroke={c.dark} strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
            {/* The hood: black over the whole skull, chin and throat, which is what the white cheeks
                are cut out of. Its lower edge dips BELOW the jaw and around the throat — a hood that
                stops at the jawline is a helmet, and a helmet is exactly the head-on-a-body read
                this pass exists to remove. */}
            {headPatch('C45.6 31.4 39.4 32.6 35 29.4C33.8 27.2 33.8 23.8 34.3 21.8', c.dark)}
            {/* The white cheeks, with the EYE SITTING ON each one rather than above it. That
                placement is both what the bird looks like and the fix for two failed passes: a small
                round black head carrying two eyes AND two separate white patches is four round marks
                fighting for one face, and it reads as a bug however they are arranged. Put the eye
                on the white and each pair collapses into one mark.
                Both are ellipses laid ALONG the skull's curve rather than circles stamped on it —
                a circle on a sphere is a sticker, and the near one at its old size was a mask. The
                near patch is the big one and the far one a sliver: the head is turned, and that
                asymmetry is what keeps the pair from reading as goggles. */}
            <ellipse cx="38.4" cy="22" rx="3.3" ry="4.4" transform="rotate(-32 38.4 22)" fill={c.accent} stroke={strokeColor} strokeWidth="1.3" />
            <ellipse cx="46.8" cy="21" rx="1.5" ry="2.9" transform="rotate(14 46.8 21)" fill={c.accent} stroke={strokeColor} strokeWidth="1.2" />
            {/* Thick red bill, two mandibles off one base: deep where it meets the face and closing
                to a point, which is the shape of this finch's bill and the half of it that survives
                being 20 pixels wide. Shortened — run out to the tile edge it stopped being a bill
                on a head and became a beak with a bird behind it. */}
            <path d="M48.8 18.6C53.2 19 56.6 20.6 57.4 22.6L48.6 23.4Z" fill={keratin} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M48.6 23.4L57.4 22.6C56.2 24.8 52.6 26.6 48.4 26.4Z" fill={keratin} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            {/* The red eye rings. On a head this dark they are not decoration — a black eye on a
                black hood is invisible, and the ring is what the eye is read by in life too. Kept
                thin and small: at the weight of a proper outline two bright rings become a pair of
                spectacles, and scaled up they become the iris of a cartoon eyeball. */}
            <circle cx="39.7" cy="18.3" r="2.15" fill="none" stroke={keratin} strokeWidth="0.85" />
            <circle cx="45.9" cy="18.3" r="1.85" fill="none" stroke={keratin} strokeWidth="0.8" />
            {headEyes()}
          </>
        );

      // 金絲雀 — the slim one, with the chest lifted and the bill open, because a canary that is not
      // singing is just a yellow bird. The open bill is anatomy, not a prop: nothing is added to the
      // tile that the player is not buying.
      case 'canary':
        return (
          <>
            {/* Slim notched tail. The notch is a single line up the middle rather than a cut shape —
                at this size a real fork closes up into a smudge, and the line reads as the split. */}
            {tailBlade(
              'M24.4 39.6C19 43 13 46.8 9.4 49.6L11.2 51.6C16.4 49 22 45.8 26.8 42.6Z',
              c.shade,
              'M10.6 50.6C15.6 48 20.8 45 25.2 42',
            )}
            {legs}
            {bodySilhouette(c.coat)}
            {/* The cream vent, low and soft */}
            <ellipse cx="33.6" cy="45.4" rx="7.6" ry="3.8" fill={c.accent} opacity="0.9" />
            {/* The warm orange, carried from the throat down over the upper chest rather than sat in
                the middle of the flank. That column IS the thickened throat this bird needed: head,
                throat and chest now read as one falling curve of colour, which is what stops a round
                head over a round body from separating into two balls. */}
            <ellipse cx="44" cy="33.4" rx="4.2" ry="5.4" transform="rotate(-16 44 33.4)" fill={mark} opacity="0.45" />
            {wing(WING_D, WING_EDGE, c.shade)}
            {/* Pale feather edges, the only marking a plain yellow canary carries. Laid ALONG the
                wing, following the run of the feathers from shoulder to tip — across it they read as
                bars, and this is not a barred bird. */}
            {['M26.6 42.6C29 40 31.6 36.6 33.4 33.4', 'M29 45C31.4 42.6 33.8 39.4 35.4 36.4'].map(d => (
              <path key={d} d={d} fill="none" stroke={c.accent} strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
            ))}
            {/* Warmth on the cheek, which is the same orange arriving at the other end of that
                column — no outline, because it is a blush and not a patch */}
            <ellipse cx="45.2" cy="24.2" rx="4.2" ry="3.4" fill={mark} opacity="0.42" />
            {/* The open bill. The dark of the throat goes down first and the two mandibles are laid
                over it, BOTH growing from the same root at the face and closing to tips that line up
                over each other. The gape is a narrow wedge now: opened wider it stops being a bird
                singing and becomes a bird with its jaw unhinged, and the upper mandible in
                particular has to stay hinged at the same point as the lower or the bill reads as
                broken in half. */}
            <path d="M48.6 21.4L56.6 20.8L48.6 26.6Z" fill={strokeColor} />
            <path d="M48.8 17.8C52.6 18 55.6 18.9 57.2 20.4L48.6 21.8Z" fill={keratin} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M48.6 25.4L56 23.9C54.8 26.2 52 27.6 48.6 27.6Z" fill={keratin} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
            {headEyes()}
          </>
        );

      // 虎皮鸚鵡 — the barred one, and the barring is drawn first-class rather than as texture: it
      // is what the bird is called in Chinese, and it is the only thing separating this from any
      // other small green parrot. The order below is the whole fix for the "insect" read it had:
      // the green body goes down FIRST and complete, the yellow wing panel is laid ON it, and the
      // black only ever runs along the wing's own feather rows and around the back of the skull.
      // Nothing is drawn straight across the belly.
      default:
        return (
          <>
            {/* The long cobalt tail, as TWO narrow feathers off the middle of the rump rather than
                one broad blade. A budgie's tail is a pair of long central streamers, and at this
                size one wide shape reading as a single plank was the whole of what was wrong with
                it. The near one is longer and reaches the far side of the tile — this is still the
                one bird on the shelf whose tail is nearly as long as it is. */}
            <path
              d="M24.4 38.8C19 41.6 13.4 44.8 9.4 47.6L10.4 48.8C15.8 46.4 21 43.6 25.6 41Z"
              fill={c.shade} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round"
            />
            <path
              d="M25 40.6C18.6 44.2 12 48 7 51.4L8.2 52.6C14.6 49.8 21.4 46.4 27 43.8Z"
              fill={mark} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round"
            />
            {legs}
            {bodySilhouette(c.coat)}
            {/* The wing panel is YELLOW, not green: a wild budgie's wing is black feathers edged in
                yellow sitting against a green body, so painting it in the coat and drawing bars on
                top would be the wrong colour under the right pattern. It leaves green showing above
                it, in front of it and below it — a budgie with no green is a stripey ball. */}
            {wing(WING_D, WING_EDGE, c.accent)}
            {/* The 虎皮 itself: rows of black crescents ACROSS the wing panel, stepped down its
                length, which is what the pattern actually is — each feather is dark with a pale
                edge, so a row of them scallops. They stay on the wing and follow its feathers; run
                round the body instead they turn a bird into a wasp. */}
            {[
              'M30.8 32.4q2.6 1.2 5 3.6',
              'M28.2 36q2.8 1.2 5.4 3.8',
              'M26 39.8q2.4 1.2 4.8 3.4',
            ].map(d => (
              <path key={d} d={d} fill="none" stroke={c.dark} strokeWidth="2.4" strokeLinecap="round" />
            ))}
            {/* The yellow mask: face, crown and chin, carried down over the throat where the spots
                are. Its lower edge is the colour boundary between mask and green breast and is the
                only edge it gets — see {@link headPatch}. */}
            {headPatch('C45.4 30.2 39.8 31.4 35.6 28.6C34.4 26.6 34 23.8 34.3 21.8', c.accent)}
            {/* Crown and nape barring, over the back half of the skull where it actually starts.
                Curved with the skull rather than ruled straight — straight dashes on a round head
                read as damage to the drawing, not as feathers. */}
            {[
              'M37.2 19Q37.7 16.9 39.7 15.7',
              'M36.2 18.7Q36.8 16.2 39.2 14.9',
              'M35.3 18.5Q36 15.6 38.7 14',
            ].map(d => (
              <path key={d} d={d} fill="none" stroke={c.dark} strokeWidth="1.5" strokeLinecap="round" />
            ))}
            {/* The blue-violet cheek patch, set low on the face — well clear of the eyes, which is
                where it belongs and also the only way it stops reading as a second pupil, and well
                clear of the BILL, because a cheek patch is only a cheek patch if there is cheek
                between it and the mouth. One, not two: the head is turned far enough that a real
                budgie's far cheek would be behind its own bill. */}
            <circle cx="40" cy="25.2" r="1.8" fill={mark} stroke={strokeColor} strokeWidth="1.2" />
            {/* Three black throat spots, on the THROAT — below the jaw, on the mask's lower half,
                which is where a budgie carries them and what stops them reading as marks on the
                face. Small: this bird carries more markings than anything else on the shelf, and
                what identifies it at chip size is the barring, not the count of dots. */}
            {[[40.4, 28.8], [43.4, 29.4], [46.4, 28.6]].map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="1.15" fill={c.dark} />
            ))}
            {/* Cere, hooked upper mandible, small lower one — three parts of ONE bill, and the rule
                that keeps three parts from reading as three loose scraps is that every edge is
                either shared with the part beside it or buried in the skull. Nothing is allowed to
                end in mid-air near the face.
                  · The cere goes down FIRST and sits wholly inside the head's outline, so the only
                    thing crossing that outline is the bill itself. It used to straddle the edge with
                    its own closed outline, which put three separate contours through one small patch
                    of face and left slivers of yellow showing between them — the "東漏西露".
                  · The mandibles share the tomium exactly: the upper's lower edge and the lower's
                    upper edge are the same three points, so the bill closes rather than gapping.
                  · Both roots sit at x≈49, comfortably inside a skull that reaches 50.6 at this
                    height, so the join is covered by the bill and never shows as a seam.
                The cere is BLUE, which is true of a cock budgie and is also the only thing keeping
                it and the beak below it from reading as one grey lump. */}
            <ellipse cx="48.2" cy="20.4" rx="2.5" ry="1.9" transform="rotate(-14 48.2 20.4)" fill={mark} stroke={strokeColor} strokeWidth="1.3" />
            <path
              d="M49 21.2C52.6 21.4 55 22.8 55.6 24.6C56 27.2 55 29.2 53.2 30.2C51.8 28.4 50.4 26.4 49 24.4Z"
              fill={keratin} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round"
            />
            <path
              d="M49 24.4C50.4 26.4 51.8 28.4 53.2 30.2C51.6 30.5 50.2 29.4 49.4 27.6C49 26.6 48.9 25.3 49 24.4Z"
              fill={keratin} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round"
            />
            {headEyes()}
          </>
        );
    }
  })();

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {art}
    </svg>
  );
}

/**
 * 抽獎券 —— 特殊卡牌那一櫃上唯一在賣的東西（constants/items.ts 的 card-raffle-ticket）。
 *
 * 兩張券疊在一起，前面那張正著、後面那張多轉一點露出一角。畫兩張是因為這是一件「會一直買」
 * 的商品：一張券在 32px 下就是一塊圓角金磚，兩張才讀得出那是可以一疊一疊拿的東西。
 *
 * 券身的形狀由三件事構成，缺一個就不像票：
 *   1. 兩側腰上的半圓缺口 —— 這是「票」這個東西的剪影，所以缺口做得夠深（半徑 5，佔券高的
 *      四成），在最小的尺寸下也還咬得出來；
 *   2. 一條垂直虛線把票根分出來；
 *   3. 兩邊各有自己的圖案：大的那半是一個小輪盤（這張券是拿去轉盤用的，圖上就該說），票根那
 *      半是一顆星。
 *
 * 缺口用 sweep-flag 0 的圓弧（外框其餘的圓角都是 1），凹進來和凸出去的差別就只有這一個數字 ——
 * 跟 UI/FragmentProgress.tsx 那枚 24px 的小券記號同一個寫法，兩者是同一張票的兩個尺寸。
 */
function RaffleTicketIcon({ size, className, strokeColor, strokeWidth }: {
  size: number; className: string; strokeColor: string; strokeWidth: string;
}) {
  /** 一張券的輪廓。圓角走順時針（sweep 1），腰上兩個缺口反過來（sweep 0）才是凹的。 */
  const body =
    'M10 19H54A4 4 0 0 1 58 23V27A5 5 0 0 0 58 37V41A4 4 0 0 1 54 45H10'
    + 'A4 4 0 0 1 6 41V37A5 5 0 0 0 6 27V23A4 4 0 0 1 10 19Z';

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* 後面那張。轉得更斜、顏色深一階，只當前面那張的影子用，所以不畫任何內容物。 */}
      <g transform="rotate(-20 32 32) translate(0 -1.5)">
        <path d={body} fill="#E1A63C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      </g>

      <g transform="rotate(-7 32 32)">
        <path d={body} fill="#F3C566" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
        {/* 上緣的反光。壓在券身裡面一點，讀起來是紙面的高光而不是第二條邊。 */}
        <path d="M12 23H52" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />

        {/* 票根的騎縫線。 */}
        <path d="M39.5 21.5V42.5" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2.6 3" />

        {/* 小輪盤：一個外圈加四道輻，中心一點。這張券唯一的用途就寫在這裡。 */}
        <circle cx="23.5" cy="32" r="8.4" fill="#FDEBC4" stroke={strokeColor} strokeWidth="2" />
        <path d="M23.5 23.6V40.4M15.1 32H31.9" stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
        <path d="M17.6 26.1L29.4 37.9M29.4 26.1L17.6 37.9" stroke={strokeColor} strokeWidth="1.3" strokeLinecap="round" opacity="0.35" />
        <circle cx="23.5" cy="32" r="2.3" fill={strokeColor} />

        {/* 票根上的星。四角星而不是五角星：五角星在這個尺寸下每個角只剩一兩個像素，糊成一團
            圓點；四角星的十字骨架縮到 32px 還看得出是一顆星。

            它是直立的橢圓形（高 12.8、寬 9.2）而不是正的，因為票根真正能用的寬度只有 13.5：
            腰上那個半徑 5 的缺口正好咬在星的高度上，正圓的星右邊那個角會從缺口裡穿出去，
            票的剪影就破了。 */}
        <path
          d="M48 25.6L49.3 30.6L52.6 32L49.3 33.4L48 38.4L46.7 33.4L43.4 32L46.7 30.6Z"
          fill="#FFF4D6" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/**
 * Which component draws which species. A pet id is `pet-<species>-<breed>` (constants/pets.ts), so
 * adding a species is a row here and adding a breed to an existing one is nothing at all — its
 * palette in PET_SPECS and its case in the component are the whole change.
 */
const PET_ICONS = [
  { id: 'dog', Icon: DogIcon },
  { id: 'cat', Icon: CatIcon },
  { id: 'bird', Icon: BirdIcon },
] as const;

/**
 * NPC 圖示 —— 兩位居民各一張正面胸像。
 *
 * 胸像而不是全身，是被尺寸逼出來的：這兩位是 2.5 頭身的 Q 版角色，整隻塞進 64 的框裡，頭只
 * 剩二十幾 px，而商店卡最小會縮到 32 —— 那個尺寸下的燕尾服和格紋褲都只是幾格雜訊，臉才是
 * 玩家認得出「這是誰」的東西。所以這裡畫的是頭、肩膀，和衣服在領口那一段。
 *
 * 構圖規則有三條，兩張圖都照著走：
 *
 *   1. 淡薰衣草紫的漸層底 —— 這兩張是「一個角色」而不是「一件商品」，需要一塊自己的底把角色
 *      從卡片上分出來。底色刻意選冷色：兩位身上（螢光黃綠、焦糖棕、稻草色）全是暖的，冷底才
 *      推得開；而它是圓角滿版的一塊底、不是一圈外框 —— 描邊的框在 32px 下會先糊成一個黑方塊。
 *   2. 四周留 10% 安全距離 —— 也就是所有東西都待在 6.4 ~ 57.6 之間。這是為了「兔子的耳朵和
 *      草帽不會被切掉」而定的：耳朵一被上緣切平，牠就從兔子變成戴帽子的什麼東西。
 *   3. 剪影優先 —— 河馬是「巨大口鼻 + 兩顆下象牙 + 圓框眼鏡」，兔子是「兩隻直立長耳 + 寬簷
 *      草帽」。這幾樣在 64px 下必須還認得出來，所以它們都畫得比寫實比例更大、更粗。
 *
 * 顏色全部來自 constants/npcs.ts 的 HIPPO / RABBIT，跟 Three/Npcs.tsx 那兩隻是同一組，所以
 * 卡片上這位不可能跟島上那位穿不一樣的衣服。形狀不共用 —— 理由寫在那份 palette 的說明裡。
 */

/**
 * 兩張 NPC 圖示共用的底：淡薰衣草紫的直向漸層，加一圈從臉的位置散開的柔光。
 *
 * 光暈非加不可：純漸層的底配上一顆深描邊的頭，頭會像被貼上去的貼紙；中間亮一階、四角暗一階
 * 之後，角色才像是站在那塊底的前面。
 *
 * id 要從外面傳進來，因為兩張圖會同時出現在同一個商店頁面上，漸層 id 撞在一起時瀏覽器只認
 * 先出現的那一個。
 */
/** 那塊底的兩個端點色。SVG 版和 NpcPortrait 的 CSS 版共用，兩邊才不會各漂各的。 */
const NPC_WASH_TOP = '#F5F0FF';
const NPC_WASH_BOTTOM = '#C2B2EC';

function NpcBackdrop({ id, frame }: { id: string; frame: NpcFrame }) {
  const [x, y, side] = frame;
  return (
    <>
      <defs>
        <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={NPC_WASH_TOP} />
          <stop offset="100%" stopColor={NPC_WASH_BOTTOM} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="40%" r="58%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={x} y={y} width={side} height={side} rx="9" fill={`url(#${id}-wash)`} />
      <rect x={x} y={y} width={side} height={side} rx="9" fill={`url(#${id}-glow)`} />
    </>
  );
}

/** 一張 NPC 圖的取景框：[左上 x, 左上 y, 邊長]，兩張都是正方形。 */
type NpcFrame = readonly [number, number, number];

/**
 * 取景框 —— 這兩張圖真正被看到的範圍，也是它們唯一跟原本那版不同的地方。
 *
 * 原本兩張都是 `0 0 64 64`，而構圖規則二（四周留 10% 安全距離）又把人推到 6.4~57.6 之間，於是
 * 一張商店卡的展示格裡有將近一半是空的紫底，讀起來就是「整個視窗只有一顆小小的頭」。改成把框
 * 縮到人身上：畫面內容一格也沒動，只是鏡頭推近，臉因此頂到左右兩邊。
 *
 * 兩個框都刻意「上緣鬆、下緣緊」：頭頂上的東西（兔子的長耳、草帽）被切到就會讓人認不出是誰，
 * 衣服下襬被切掉則是半身照本來就該有的樣子。
 */
const NPC_FRAME = {
  // 河馬：左右卡在燕尾服的肩線（x 9~55），下緣切在燕尾服下襬上。
  hippo: [9, 6, 46] as NpcFrame,
  // 兔子：左右卡在上衣的肩線（x 8~56），耳尖離上緣還有 1 格，下緣切在領口下面。
  rabbit: [6, 5, 52] as NpcFrame,
};

/**
 * 這兩位在畫面上有兩種身分，所以 <svg> 的尺寸有兩種寫法：
 *
 *   `bleed = false` —— 商品列表裡的一枚縮圖，跟其他圖示一樣是固定邊長的一格，紫底自己畫。
 *   `bleed = true`  —— 商店卡與購買視窗裡的一張人物照：撐滿容器的高度，紫底改由外面那層 CSS
 *                      畫滿整格（見 NpcPortrait）。一張 110px 的小方牌擺在 236px 寬的展示格
 *                      正中間，不管裡面的人畫多大，看起來都還是一張貼在窗口中央的小貼紙。
 */
function npcSvgSize(size: number, bleed: boolean) {
  return bleed ? { width: '100%', height: '100%' } : { width: size, height: size };
}

function HippoButlerIcon({ size, className, strokeColor, strokeWidth, bleed = false }: {
  size: number; className: string; strokeColor: string; strokeWidth: string; bleed?: boolean;
}) {
  const [fx, fy, fs] = NPC_FRAME.hippo;
  // 頭髮裁在頭的輪廓裡用的 clip。滿版與縮圖兩版的頭一模一樣，所以 id 撞在一起也指到同一顆頭。
  const headClip = bleed ? 'npcHippo-head-bleed' : 'npcHippo-head';
  return (
    <svg {...npcSvgSize(size, bleed)} viewBox={`${fx} ${fy} ${fs} ${fs}`} fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <clipPath id={headClip}>
          <ellipse cx="32" cy="22" rx="15.8" ry="14.2" />
        </clipPath>
      </defs>
      {/* 滿版的那版由 NpcPortrait 在外面畫底，這裡只出人 —— 兩層都畫會在人身後多出一圈邊。 */}
      {!bleed && <NpcBackdrop id="npcHippo" frame={NPC_FRAME.hippo} />}

      {/* 兩枚小圓耳，坐在頭的兩個上角上。位置比想像中高很多，這是刻意的：耳朵一掉到眼睛的
          高度，這張臉就從河馬變成猴子 —— 河馬的耳朵長在頭頂的稜線上，不在臉的兩側。畫在頭
          之前，所以耳根埋進頭裡，而不是黏在頭旁邊的兩顆球。
          耳內那點洋紅往「外」偏而不是往內：往內的那半邊會被頭髮蓋掉，結果是左耳素面、右耳
          一塊洋紅，看起來像其中一隻耳朵受傷了。 */}
      {[[17.8, -1], [46.2, 1]].map(([cx, s]) => (
        <g key={cx}>
          <ellipse cx={cx} cy={13.4} rx={5.4} ry={5} fill={HIPPO.skin} stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx={cx + s * 1} cy={13.8} rx={2.6} ry={2.2} fill={HIPPO.innerEar} opacity="0.55" />
        </g>
      ))}

      {/* 燕尾服的肩線與領口。整組畫在頭之前：這位的頭占掉整張圖的上三分之二，衣服本來就
          只看得到下巴以下那一截，硬把它畫在頭上面只會把下巴切掉。下緣的兩個圓角是為了讓
          這一截讀起來是「一座半身像的底座」，而不是「一張被下緣切掉的全身圖」。 */}
      <path
        d="M9 54C9 47.6 19.4 43.4 32 43.4C44.6 43.4 55 47.6 55 54L55 55A2.6 2.6 0 0 1 52.4 57.6L11.6 57.6A2.6 2.6 0 0 1 9 55Z"
        fill={HIPPO.coat} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
      />
      {/* 左肩的一道亮面。這件外套暗到接近黑，沒有它，肩膀那一截是一塊沒有形狀的深色。 */}
      <path d="M13.6 52.4C14.8 48.8 20.4 46.2 27.4 45.2" fill="none" stroke={HIPPO.lapel} strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
      {/* 窄版緞面翻領：沿著襯衫的 V 領外緣走的一條亮一階的帶子。 */}
      <path d="M25.4 45L32 56L38.6 45" fill="none" stroke={HIPPO.lapel} strokeWidth="4.4" strokeLinejoin="round" />
      {/* 象牙白襯衫的 V 領。 */}
      <path d="M25.8 44L32 56L38.2 44Z" fill={HIPPO.shirt} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      {/* 暗酒紅領結。做成蝴蝶結而不是一條領帶：兩片圓圓的翅膀比一截往下收的帶子可愛得多，
          而且縮到 40px 還是讀得出「打了個結」。 */}
      <path d="M32 47.6L27.4 45.4C26.4 45 25.8 45.6 25.8 46.6V49.4C25.8 50.4 26.4 51 27.4 50.6L32 48.4L36.6 50.6C37.6 51 38.2 50.4 38.2 49.4V46.6C38.2 45.6 37.6 45 36.6 45.4Z" fill={HIPPO.tie} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
      <ellipse cx="32" cy="48" rx="1.7" ry="1.9" fill={HIPPO.tie} stroke={strokeColor} strokeWidth="1.4" />

      {/* 頭。刻意比下面那個口鼻窄 —— 見口鼻那一段。 */}
      <ellipse cx="32" cy="22" rx="15.8" ry="14.2" fill={HIPPO.skin} />
      {/* 背光的那半邊。一片壓在頭裡面的淡陰影 —— 沒有它，這顆頭是一塊平的綠色。 */}
      <ellipse cx="38.8" cy="21.8" rx="7" ry="9.4" fill={HIPPO.shade} opacity="0.22" />

      {/* 頭髮：一整頂蓋滿頭頂的側分髮，裁在頭的輪廓裡。
          原本那片只蓋左邊三分之二、右端收成尖的，右上露出一塊綠額頭 —— 本意是「側分」，
          讀出來卻是「右邊那塊頭髮不見了」。現在頭頂整片都是頭髮，分線在右邊，分線左側那一
          大片往左額斜掃下來，右側短短一截收在右耳根：兩邊都有頭髮，只是長短不同，才是側分。
          裁在頭的輪廓裡是為了耳朵：頭髮的形狀可以隨便往外畫，永遠不會吃掉任何一隻耳朵。 */}
      <g clipPath={`url(#${headClip})`}>
        <path
          d="M10 3H54V16.4C51.4 14.4 47.6 12.6 43.6 12.4C42 12.3 40.6 12.6 39.4 13.2C35.4 15.6 31 17 27 17.4C24.2 17.7 22.6 19.2 21.6 21.2C19 19.8 15.6 19.6 10 21Z"
          fill={HIPPO.hair} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round"
        />
        {/* 髮絲的亮面：一道順著頭頂弧度走的淡白弧。 */}
        <path d="M21.4 12.6C24.4 9.8 28.6 8.8 32.6 9.2" fill="none" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" opacity="0.35" />
        {/* 分線。 */}
        <path d="M39.4 13.2C38.6 11.4 38.6 9.6 39.4 8" fill="none" stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
        {/* 兩道順著梳向走的髮絲。一整塊平塗的咖啡色讀起來是一頂安全帽；多兩條從分線往左額
            掃下去的細線，它才變回一片梳過的頭髮。 */}
        <path d="M37.6 11.6C34.2 13.6 30.4 14.8 26.4 15.2" fill="none" stroke={strokeColor} strokeWidth="1.1" strokeLinecap="round" opacity="0.3" />
        <path d="M36.4 9.2C33 10.8 29.4 11.8 25.8 12.2" fill="none" stroke={strokeColor} strokeWidth="1.1" strokeLinecap="round" opacity="0.22" />
      </g>
      {/* 頭的描邊最後補一圈 —— 頭髮是裁在頭裡的，外緣那半條描邊跟著被裁掉了。 */}
      <ellipse cx="32" cy="22" rx="15.8" ry="14.2" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />

      {/* 巨大的口鼻。這是整隻最強的辨識特徵，畫得比頭還寬 2px —— 這 2px 就是「河馬」和「一隻
          綠色的熊」的全部差別：口鼻要頂破頭的輪廓、從剪影上就看得出來，收在臉裡面就只是一張
          嘴。深一階的那顆只往下偏 1.6，露出來的一圈就是下顎的陰影。 */}
      <ellipse cx="32" cy="35.4" rx="17.6" ry="8" fill={HIPPO.shade} />
      <ellipse cx="32" cy="33.8" rx="17.6" ry="8" fill={HIPPO.light} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* 口鼻上緣的一道亮光，讓這塊讀起來是鼓起來的一團。短而淡：拉長、拉亮就成了一層油光。 */}
      <path d="M23.4 28.4C25.8 27.3 28.8 27 31.2 27.1" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" opacity="0.3" />
      {/* 腮紅。淡、小、邊緣收在口鼻上緣 —— 濃而大的兩團紅是「臉紅發燙」，不是和氣。 */}
      {/* 不透明度不能壓太低：半透明的橘粉疊在黃綠上會混成一塊泥巴色。 */}
      <ellipse cx="19.6" cy="28.2" rx="2.6" ry="1.6" fill={HIPPO.blush} opacity="0.8" />
      <ellipse cx="44.4" cy="28.2" rx="2.6" ry="1.6" fill={HIPPO.blush} opacity="0.8" />

      {/* 兩個小鼻孔。只是兩粒淡淡的小橢圓：原本那兩個深色大洞是整張臉最先被看到的東西，
          一張臉的焦點落在鼻孔上，就從可愛變成不舒服。 */}
      <ellipse cx="28.4" cy="30.8" rx="1.05" ry="1.35" fill={HIPPO.nostril} opacity="0.5" transform="rotate(-14 28.4 30.8)" />
      <ellipse cx="35.6" cy="30.8" rx="1.05" ry="1.35" fill={HIPPO.nostril} opacity="0.5" transform="rotate(14 35.6 30.8)" />
      {/* 閉著的一道淺淺微笑。原本是咧開的深色大嘴加兩顆探出來的門牙 —— 那個表情讀起來是
          賊笑、流口水，不是管家。管家的笑是抿著的：短、細、嘴角微微上揚就夠。 */}
      <path d="M28.2 35.6C30.2 37.4 33.8 37.4 35.8 35.6" fill="none" stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" />

      {/* 眼睛。溫和的深色小圓眼加一點高光。原本的白眼球 + 大藍虹膜被眼鏡框住之後，像是
          透過放大鏡瞪著人看；眼睛收小、不留眼白，視線才是柔的。 */}
      {[25.4, 38.6].map(cx => (
        <g key={cx}>
          <ellipse cx={cx} cy="21" rx="2.3" ry="2.7" fill={HIPPO.pupil} />
          <circle cx={cx + 0.8} cy="20" r="0.85" fill="#FFFFFF" />
        </g>
      ))}

      {/* 藍色圓框眼鏡。管家的第二個辨識點：一副正圓、左右一樣大、擺得端端正正的細框眼鏡。
          細框才是斯文 —— 框一粗、鏡片一大，就是一副把眼睛放大的厚底眼鏡。鏡腳先畫、收在臉
          的輪廓上，才像是繞到耳朵後面。 */}
      <path d="M20.2 20.4L17.2 19.6" stroke={HIPPO.glassFrame} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M43.8 20.4L46.8 19.6" stroke={HIPPO.glassFrame} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="25.4" cy="21" r="5.2" fill={HIPPO.glassLens} fillOpacity="0.18" stroke={HIPPO.glassFrame} strokeWidth="1.4" />
      <circle cx="38.6" cy="21" r="5.2" fill={HIPPO.glassLens} fillOpacity="0.18" stroke={HIPPO.glassFrame} strokeWidth="1.4" />
      {/* 鼻樑上的鏡橋。稍微往上拱，兩片才連得像一副眼鏡而不是兩個圈。 */}
      <path d="M30.6 20.6C31.4 19.6 32.6 19.6 33.4 20.6" fill="none" stroke={HIPPO.glassFrame} strokeWidth="1.4" strokeLinecap="round" />
      {/* 玻璃的反光。兩片同方向的一道短弧 —— 方向不同就成了兩片各自反光的玻璃。 */}
      <path d="M22.2 18.6A3.6 3.6 0 0 1 24.6 16.8" fill="none" stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round" opacity="0.6" />
      <path d="M35.4 18.6A3.6 3.6 0 0 1 37.8 16.8" fill="none" stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function CookieRabbitIcon({ size, className, strokeColor, strokeWidth, bleed = false }: {
  size: number; className: string; strokeColor: string; strokeWidth: string; bleed?: boolean;
}) {
  const [fx, fy, fs] = NPC_FRAME.rabbit;
  /** 餅乾斑點。跟 3D 一樣是手排的：避開臉的正面，也沒有兩顆疊在一起。 */
  const specks: [number, number, number][] = [
    [20.8, 39.6, 1], [43.4, 39.2, 0.95], [23.4, 50, 1.05], [41, 50.2, 1],
  ];
  return (
    <svg {...npcSvgSize(size, bleed)} viewBox={`${fx} ${fy} ${fs} ${fs}`} fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {!bleed && <NpcBackdrop id="npcRabbit" frame={NPC_FRAME.rabbit} />}

      {/* 兩隻非常長、末端圓鈍的耳朵。畫在頭與帽子之前：耳根埋進帽冠後面，露在帽子上面的那
          一整截就是這隻的剪影 —— 這也是「耳朵從帽冠的孔裡伸出來」在平面上唯一的講法。
          兩隻外撇的角度故意不一樣（左 12、右 8）：左右完全對稱的一對耳朵是招牌，歪一點的
          才是一隻活的兔子。兩隻都完整落在取景框裡，被切平的耳朵會讓牠變成戴帽子的什麼東西。 */}
      {[[26.6, -12], [37.4, 8]].map(([cx, rot]) => (
        <g key={cx} transform={`rotate(${rot} ${cx} 27)`}>
          <rect x={cx - 3.7} y="6.8" width="7.4" height="22" rx="3.7" fill={RABBIT.skin} stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* 耳窩。比外緣暖一階的一條，讓耳朵讀起來有正反面而不是兩片色紙。 */}
          <rect x={cx - 1.7} y="9.6" width="3.4" height="11.4" rx="1.7" fill={RABBIT.blush} opacity="0.6" />
        </g>
      ))}

      {/* 奶油白棉麻上衣的肩線。下緣兩個圓角的理由跟管家那件一樣。 */}
      <path
        d="M8 55.6C8 49.8 18.6 46.4 32 46.4C45.4 46.4 56 49.8 56 55.6V56.6A2.6 2.6 0 0 1 53.4 59.2H10.6A2.6 2.6 0 0 1 8 56.6Z"
        fill={RABBIT.shirt} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
      />

      {/* 圓球頭。比原本大一圈（半徑 11.6 → 13.4）：原本那顆頭被一頂 50 寬的帽子罩著，帽簷
          是頭的兩倍多寬，讀起來是一頂墨西哥帽底下掛著一張小臉。頭大起來、帽簷收窄之後，
          比例才回到「一隻戴著遮陽帽的兔子」。 */}
      <circle cx="32" cy="40.4" r="13.4" fill={RABBIT.skin} stroke={strokeColor} strokeWidth={strokeWidth} />
      {/* 餅乾斑點只留在臉的外圍、而且很淡。臉上幾顆實心深棕點在這個尺寸下讀起來是痘痘或
          皮膚病，不是餅乾。 */}
      {specks.map(([cx, cy, r]) => <circle key={cx} cx={cx} cy={cy} r={r * 0.8} fill={RABBIT.speck} opacity="0.3" />)}

      {/* 額前那撮毛。這就是之前「戴了帽子頭髮就不見了」的那個洞：原本帽簷直接壓在頭頂上，
          頭頂那一圈毛整個被帽子吃掉，帽簷下緣緊接著就是眼睛，看起來像頭被削掉一截。現在帽子
          是「戴在」頭上的，帽簷下面露出一排三瓣的蓬毛，毛還在、只是被帽子壓住了。
          畫在帽子之前：帽子壓在毛上面，不是毛長在帽子外面。上緣畫進帽簷裡，所以帽子怎麼歪
          都不會在毛和帽簷之間露出縫。 */}
      {/* 描邊用淡淡的斑點色而不是全黑：一排深色粗描邊的小圓瓣貼在額頭上，讀起來是結痂。 */}
      <path
        d="M22.4 28.6C22 32.6 24 35.2 27 34.6C28.8 36.2 35.2 36.2 37 34.6C40 35.2 42 32.6 41.6 28.4Z"
        fill={RABBIT.skin} stroke={RABBIT.speck} strokeOpacity="0.55" strokeWidth="1.2" strokeLinejoin="round"
      />

      {/* 嘴邊一片淡淡的白色口吻。原本是左右兩團 + ω 嘴，合起來就是網路上那張「uwu」臉；
          收成一整片、壓淡，才是一隻安靜的兔子。 */}
      <ellipse cx="32" cy="47.4" rx="5.4" ry="3.2" fill="#FFFFFF" opacity="0.3" />
      {/* 腮紅。淡、小：濃紅的兩團配上水汪汪的眼睛，表情會往害羞發燙那邊偏。 */}
      <ellipse cx="22.6" cy="46" rx="2.6" ry="1.6" fill={RABBIT.blush} opacity="0.55" />
      <ellipse cx="41.4" cy="46" rx="2.6" ry="1.6" fill={RABBIT.blush} opacity="0.55" />
      {/* 兩顆霧面深色的小圓眼，一顆高光。眼睛比原本收一圈 —— 太大、太亮的眼睛放在這張小臉上
          像是在瞪人；位置卡在那撮毛以下，毛或帽簷一壓到眼睛，整張臉就沒了。 */}
      {[26.6, 37.4].map(cx => (
        <g key={cx}>
          <ellipse cx={cx} cy="42" rx="2.5" ry="2.9" fill={RABBIT.face} />
          <circle cx={cx + 0.8} cy="41" r="0.9" fill="#FFFFFF" />
        </g>
      ))}
      {/* 小小的圓鼻子，底下一道很淺的微笑 —— 最小的一點點表情。 */}
      <ellipse cx="32" cy="45.6" rx="1.3" ry="0.9" fill={RABBIT.face} opacity="0.85" />
      <path d="M30.4 47.6C31.3 48.4 32.7 48.4 33.6 47.6" fill="none" stroke={RABBIT.face} strokeOpacity="0.7" strokeWidth="1" strokeLinecap="round" />

      {/* 草帽。整頂往左歪 6 度戴著：端端正正蓋在頭上的帽子是一個蓋子，歪一點才是戴上去的。
          所有零件都在這一組裡一起歪，帽冠、帽簷、帽帶才不會各歪各的。 */}
      <g transform="rotate(-6 32 29)">
        {/* 帽簷投在那撮毛上的陰影。沒有它，帽子是浮在頭前面的一片。 */}
        <ellipse cx="32" cy="32.4" rx="11.6" ry="3" fill={RABBIT.speck} opacity="0.2" />
        {/* 帽冠。較淺的圓頂，畫在耳朵之後 —— 耳朵從帽子後面竄上去，就是 3D 那個「帽頂開孔讓
            耳朵穿過去」的平面說法。 */}
        <path d="M21.4 29.4C21.4 23.2 26 20.4 32 20.4C38 20.4 42.6 23.2 42.6 29.4Z" fill={RABBIT.straw} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
        {/* 寬簷。比頭寬六成 —— 再窄讀不出是寬簷，再寬（原本是兩倍多）就成了墨西哥帽。 */}
        <ellipse cx="32" cy="29" rx="21" ry="4.2" fill={RABBIT.straw} stroke={strokeColor} strokeWidth={strokeWidth} />
        {/* 帽簷的背面。下緣那一道暗色，是「這片帽簷是往下垂的」的全部。 */}
        <path d="M11 29A21 4.2 0 0 0 53 29A21 2.2 0 0 1 11 29Z" fill={RABBIT.strawDark} />
        {/* 麥稈的亮面。只走左半邊、而且很淡：整條橫過去的白線會讀成帽簷裂了一道縫。 */}
        <path d="M16.4 27.8C19.8 26.6 24.6 26.1 29.4 26.1" fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.32" />
        {/* 紅棕帽帶，繞在帽冠根部。 */}
        <path d="M22.2 25.2C26 28.2 38 28.2 41.8 25.2" fill="none" stroke={RABBIT.brick} strokeWidth="3.2" strokeLinecap="round" />
      </g>

      {/* 領口，與紅棕細滾邊。紅棕在這張圖裡的第二處，也是最後一處 —— 3D 那隻把它嚴格限制
          在三個地方，圖示縮到 32px 只放得下兩個。
          3D 那隻帽子上的繫繩在這裡整條拿掉了：兩條從帽簷垂到下巴的細線正好框在臉的兩側，
          縮到 40px 就跟腮紅、下巴糊成一團鬍子，而它在這個尺寸下什麼也沒說明。 */}
      <path d="M21 52.4C24.4 57.2 39.6 57.2 43 52.4" fill={RABBIT.shirt} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      <path d="M23.2 54.2C26.2 57.2 37.8 57.2 40.8 54.2" fill="none" stroke={RABBIT.brick} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 這個 id 有沒有滿版人物照可以放？—— 目前就這兩位居民。 */
export function isNpcPortrait(itemId: string) {
  return itemId === 'npc-hippo-butler' || itemId === 'npc-cookie-rabbit';
}

/**
 * NPC 的滿版人物照 —— 填滿呼叫端整格的一張半身照，給商店卡的展示格和購買視窗用。
 *
 * 跟 QVersionIcon 走不同一條路，是因為那條路上的每一件商品都是「一個擺在格子裡的東西」：外面
 * 那層固定邊長的方框、底下那圈落地陰影、統一的 drop-shadow，全都在講「這是一件放在檯面上的道
 * 具」。可是這兩位不是道具而是人，一顆縮在展示格正中央的小頭讀起來就只是一張貼紙。所以這裡把
 * 那層框和陰影全部拿掉，改成：紫底鋪滿整格（CSS，因為要跟著格子變寬，SVG 只會跟著人一起長高），
 * 人靠高度撐滿、水平置中。
 *
 * 呼叫端要給這個元件一格有確定高度的空間（實務上都是 `absolute inset-0`）——高度不確定時
 * `height: 100%` 會塌成 0，畫面上就什麼都沒有。
 */
export function NpcPortrait({ itemId, className = '' }: { itemId: string; className?: string }) {
  const Figure = itemId === 'npc-hippo-butler' ? HippoButlerIcon : CookieRabbitIcon;
  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ background: `linear-gradient(180deg, ${NPC_WASH_TOP} 0%, ${NPC_WASH_BOTTOM} 100%)` }}
    >
      {/* 跟 NpcBackdrop 同一圈柔光，理由也一樣：沒有它，人像是被貼在一塊平的紫色上。 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(58% 56% at 50% 40%, rgba(255,255,255,0.72), rgba(255,255,255,0) 72%)' }}
      />
      {/* 人。drop-shadow 留著 —— 它是這張圖裡唯一把人從那塊紫底上撐開的東西；
          size 在 bleed 模式下不參與（見 npcSvgSize），高度由這層 inset-0 決定。 */}
      <div
        className="absolute inset-0"
        style={{ filter: 'drop-shadow(0 3px 3px rgba(38,70,83,0.22))' }}
      >
        <Figure bleed size={0} className="block" strokeColor="#3D2A1C" strokeWidth="2.5" />
      </div>
    </div>
  );
}

/**
 * 佔位圖示 —— 一個大問號。
 *
 * 給「東西已經存在，但它的商店圖示還沒畫」的品項用，目前是 NPC。刻意跟本檔最下面那個灰色
 * default fallback 長得不一樣：那個是「這個 id 我不認得」的意外，這個是「我認得，只是還沒畫」
 * 的宣告，兩者在卡片上必須看得出差別，否則沒有人知道該不該去修。
 *
 * 用本檔共用的描邊與圓角語言畫，所以放在一整排手繪圖示中間不會像個破圖。
 */
function UnknownIcon({ size, className, strokeColor, strokeWidth }: {
  size: number; className: string; strokeColor: string; strokeWidth: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* 圓角方牌。奶油底配暖棕描邊，跟其他圖示同一套顏色。 */}
      <rect x="8" y="8" width="48" height="48" rx="14" fill="#FDF3E3" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <rect x="13" y="13" width="38" height="38" rx="10" fill="#F6E3C5" />
      {/* 問號的鉤。粗描邊 + 圓端點，縮到 32px 也還讀得出來。 */}
      <path
        d="M23.5 25.5C23.5 20.8 27.3 17.5 32 17.5C36.7 17.5 40.5 20.8 40.5 25.5C40.5 30.2 36 31.4 33.8 33.6C32.6 34.8 32 36.1 32 38"
        stroke={strokeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 問號的點。 */}
      <circle cx="32" cy="45.5" r="3.6" fill={strokeColor} />
    </svg>
  );
}

/**
 * The icon itself, without the shared shadow/lift wrapper {@link QVersionIcon} adds.
 *
 * Exported for `npm run audit:shop`, which renders it for every catalog id and compares the tree
 * against the tree an unknown id produces — that is how it tells 「這件商品有畫」 from 「這件商品
 * 掉進最下面那個灰色 default」 without keeping a second list of ids that would go stale. It is a
 * plain hook-free function precisely so that audit can call it with no renderer.
 *
 * Nothing in the app should use this directly; render {@link QVersionIcon}.
 */
export function QVersionIconInner({ itemId, categoryId, size = 32, className = "" }: QVersionIconProps) {
  const currentId = itemId || categoryId || "";

  // Common styles
  const strokeColor = "#3D2A1C"; // Cozy deep warm brown border for a lovely cartoon outline
  const strokeWidth = "2.5";

  // Render Category Icons (First Layer)
  if (categoryId) {
    switch (categoryId) {
      case 'tables_chairs':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F5D0A9" />
                <stop offset="100%" stopColor="#C68E5A" />
              </linearGradient>
              <linearGradient id="cushionGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#FFB3B3" />
                <stop offset="100%" stopColor="#FF6B6B" />
              </linearGradient>
            </defs>
            {/* Cute wooden chair */}
            <path d="M12 36V18C12 16.5 13.5 15 15 15H23C24.5 15 26 16.5 26 18V36" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="#E5C29B" />
            <rect x="8" y="32" width="22" height="6" rx="3" fill="url(#cushionGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M12 38V52M26 38V52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            {/* Cute wooden table */}
            <path d="M34 26V48M56 26V48" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            <rect x="28" y="18" width="32" height="8" rx="4" fill="url(#woodGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M32 20H56" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
          </svg>
        );
      case 'beds':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="bedWood" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#D29965" />
                <stop offset="100%" stopColor="#9C663D" />
              </linearGradient>
              <linearGradient id="sheetGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E0F7FA" />
                <stop offset="100%" stopColor="#80DEEA" />
              </linearGradient>
              <linearGradient id="pillowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#FFF" />
                <stop offset="100%" stopColor="#FFD54F" />
              </linearGradient>
            </defs>
            {/* Headboard */}
            <rect x="8" y="12" width="48" height="20" rx="6" fill="url(#bedWood)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Mattress/Sheets */}
            <rect x="10" y="26" width="44" height="24" rx="5" fill="url(#sheetGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Puffy Pillow */}
            <rect x="16" y="20" width="16" height="10" rx="3" fill="url(#pillowGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <rect x="34" y="20" width="16" height="10" rx="3" fill="url(#pillowGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Bed legs */}
            <path d="M12 50V56M52 50V56" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            {/* Cute folded blanket line */}
            <path d="M10 38H54" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M10 26C16 32 48 32 54 26" stroke="#FFF" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
          </svg>
        );
      case 'cabinets':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="cabWood" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E5A65D" />
                <stop offset="100%" stopColor="#B2742A" />
              </linearGradient>
            </defs>
            {/* Main Cabinet body */}
            <rect x="10" y="10" width="44" height="42" rx="6" fill="url(#cabWood)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Drawer 1 */}
            <rect x="14" y="15" width="36" height="14" rx="4" fill="#FFFBEB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <circle cx="32" cy="22" r="3" fill="#D97706" stroke={strokeColor} strokeWidth="1.5" />
            {/* Drawer 2 */}
            <rect x="14" y="33" width="36" height="14" rx="4" fill="#FFFBEB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <circle cx="32" cy="40" r="3" fill="#D97706" stroke={strokeColor} strokeWidth="1.5" />
            {/* Legs */}
            <path d="M14 52V58M50 52V58" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          </svg>
        );
      // 燈具. Drawn long before there was a shelf to put it on — it sat here unreferenced until
      // the 燈具 category was split out of 裝飾 (2026-09-03) and claimed `artKey: 'lighting'`.
      case 'lighting':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <radialGradient id="glow" cx="50%" cy="45%" r="50%">
                <stop offset="0%" stopColor="#FDE047" stopOpacity="1" />
                <stop offset="60%" stopColor="#F59E0B" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* Soft glowing aura */}
            <circle cx="32" cy="28" r="20" fill="url(#glow)" />
            {/* Lamp / Bulb */}
            <path d="M22 28C22 18 26.5 14 32 14C37.5 14 42 18 42 28C42 34 38 38 36 41H28C26 38 22 34 22 28Z" fill="#FEF08A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Cap */}
            <rect x="27" y="41" width="10" height="5" rx="1" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <rect x="29" y="46" width="6" height="4" rx="1" fill="#64748B" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
            {/* Filament */}
            <path d="M29 25L32 18L35 25" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="32" cy="18" r="1.5" fill="#EF4444" />
            {/* Shiny sparkle */}
            <path d="M46 16L49 19M49 16L46 19" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      case 'rugs':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="rugGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F97316" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
            </defs>
            {/* Rug Base */}
            <rect x="8" y="16" width="48" height="32" rx="16" fill="url(#rugGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Inner Pattern */}
            <rect x="14" y="21" width="36" height="22" rx="11" stroke="#FFF" strokeWidth="2" strokeDasharray="3 3" opacity="0.75" />
            <circle cx="32" cy="32" r="6" fill="#FEF3C7" stroke={strokeColor} strokeWidth="2" />
            {/* Tassel details */}
            <path d="M4 32H8M56 32H60M5 24H8M5 40H8M56 24H59M56 40H59" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      case 'plants':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="leafGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#4ADE80" />
                <stop offset="100%" stopColor="#15803D" />
              </linearGradient>
              <linearGradient id="potGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFedd5" />
                <stop offset="100%" stopColor="#fed7aa" />
              </linearGradient>
            </defs>
            {/* Plant Pot */}
            <path d="M22 38L24 54C24 55 25 56 26 56H38C39 56 40 55 40 54L42 38H22Z" fill="url(#potGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <rect x="20" y="34" width="24" height="5" rx="2" fill="#F97316" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Big cute leaves */}
            <path d="M32 34C32 34 26 22 20 22C14 22 14 30 24 32C29 33 32 34 32 34Z" fill="url(#leafGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M32 34C32 34 38 22 44 22C50 22 50 30 40 32C35 33 32 34 32 34Z" fill="url(#leafGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M32 34C32 34 32 14 32 10C26 10 26 18 30 26C31 28 32 34 32 34Z" fill="#22C55E" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Sparkle */}
            <circle cx="48" cy="14" r="2" fill="#FBBF24" />
          </svg>
        );
      case 'wall_decor':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="artGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6EE7B7" />
                <stop offset="100%" stopColor="#3B82F6" />
              </linearGradient>
            </defs>
            {/* Wooden frame */}
            <rect x="10" y="12" width="44" height="40" rx="4" fill="#8B5A2B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Inner Art canvas */}
            <rect x="15" y="17" width="34" height="30" rx="2" fill="url(#artGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Cute Sun in painting */}
            <circle cx="22" cy="25" r="4" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.5" />
            {/* Cute Mountain waves */}
            <path d="M15 42L24 33L31 39L40 28L49 42H15Z" fill="#D1FAE5" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          </svg>
        );
      case 'decorations':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="radioBody" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#EC4899" />
                <stop offset="100%" stopColor="#BE185D" />
              </linearGradient>
            </defs>
            {/* Cute antenna */}
            <path d="M26 18L18 8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="18" cy="8" r="3" fill="#F43F5E" stroke={strokeColor} strokeWidth="1.5" />
            {/* Radio casing */}
            <rect x="12" y="18" width="40" height="32" rx="8" fill="url(#radioBody)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Handle */}
            <path d="M20 18V14C20 12.5 21.5 11 23 11H41C42.5 11 44 12.5 44 14V18" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            {/* Speaker Grille */}
            <circle cx="25" cy="35" r="10" fill="#FFF" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M20 35H30M25 30V40" stroke={strokeColor} strokeWidth="1.5" />
            {/* Dialers */}
            <circle cx="43" cy="28" r="3" fill="#FFFBEB" stroke={strokeColor} strokeWidth="1.5" />
            <circle cx="43" cy="38" r="3" fill="#FFFBEB" stroke={strokeColor} strokeWidth="1.5" />
            {/* Note sparkle */}
            <path d="M50 14V8L55 10V14" stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="#A78BFA" />
          </svg>
        );
      case 'surfaces':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="bucketGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#94A3B8" />
                <stop offset="100%" stopColor="#475569" />
              </linearGradient>
              <linearGradient id="paintSplash" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#A78BFA" />
                <stop offset="100%" stopColor="#8B5CF6" />
              </linearGradient>
            </defs>
            {/* Paint Bucket */}
            <path d="M12 24L15 50C15 52 17 54 19 54H41C43 54 45 52 45 50L48 24H12Z" fill="url(#bucketGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <ellipse cx="30" cy="24" rx="18" ry="6" fill="url(#paintSplash)" stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Paint dripping */}
            <path d="M15 28C15 28 17 38 21 38C25 38 24 28 24 28" fill="url(#paintSplash)" stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Handle */}
            <path d="M12 24C12 12 48 12 48 24" stroke={strokeColor} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
            {/* Brush next to it */}
            <path d="M46 36L56 16" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            <rect x="42" y="34" width="8" height="10" rx="2" fill="#D97706" stroke={strokeColor} strokeWidth="1.5" transform="rotate(-25 46 39)" />
            <rect x="39" y="42" width="10" height="6" fill="#A78BFA" stroke={strokeColor} strokeWidth="1.5" transform="rotate(-25 44 45)" />
          </svg>
        );
      case 'artwork':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="artFrameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#C89B6A" />
                <stop offset="100%" stopColor="#8D6E52" />
              </linearGradient>
            </defs>
            {/* A framed picture, with a small sculpture standing in front of it — the category
                holds both, and an icon showing only a painting would under-promise. */}
            <rect x="10" y="8" width="38" height="32" rx="4" fill="url(#artFrameGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <rect x="15" y="13" width="28" height="22" fill="#FDF6E7" stroke={strokeColor} strokeWidth="1.5" />
            <rect x="15" y="27" width="28" height="8" fill="#2A9D8F" />
            <circle cx="36" cy="19" r="4" fill="#E9C46A" />
            <path d="M17 27 L26 16 L34 27 Z" fill="#E07A5F" />
            <rect x="15" y="13" width="28" height="22" fill="none" stroke={strokeColor} strokeWidth="1.5" />
            {/* Plinth and sculpture */}
            <rect x="36" y="44" width="18" height="12" rx="2" fill="#EFE9DC" stroke={strokeColor} strokeWidth={strokeWidth} />
            <circle cx="45" cy="39" r="6" fill="#586F7C" stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Little vase */}
            <path d="M14 56 h12 l-2 -12 h-8 Z" fill="#F0E6D2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M20 44 v-6" stroke="#6B8F71" strokeWidth="2" strokeLinecap="round" />
            <circle cx="20" cy="36" r="3" fill="#E07A5F" stroke={strokeColor} strokeWidth="1.2" />
          </svg>
        );

      // ─────────────────────────────────────────────────────────────────────
      // 以下六張是為了「把撞在一起的分類拆開」而畫的。
      //
      // 分類磚的美術是靠 `artKey` 指派的（utils/categoryUtils.ts），而在這之前 14 個分類只用了
      // 6 張圖：花園與樹木同一張、地板與牆面同一張、廚房衛浴與收納同一張、室內裝飾／室外裝飾／
      // 互動物件三個共用同一張、臥室與寵物窩同一張、藝術品與室外裝置同一張。其中四對是**同一個
      // 抽屜裡並排**的，玩家看到的就是兩塊一模一樣的磚。
      //
      // 每個 gradient 的 id 都帶自己的前綴：一個抽屜會同時畫出六張磚，同名的 defs 只有第一個算
      // 數，後面的會靜靜地拿到別人的顏色。
      // ─────────────────────────────────────────────────────────────────────

      // 樹木 —— 跟 `plants`（盆栽）拆開。一棵有樹幹的樹，不是種在盆子裡的東西。
      case 'trees':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="treeCanopyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#5FD68A" />
                <stop offset="100%" stopColor="#1F7A45" />
              </linearGradient>
              <linearGradient id="treeTrunkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C68E5A" />
                <stop offset="100%" stopColor="#8B5A2B" />
              </linearGradient>
            </defs>
            {/* Trunk, with two little roots so it reads as planted in the ground */}
            <path d="M29 40V54H35V40Z" fill="url(#treeTrunkGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M29 54C25 54 23 56 21 56M35 54C39 54 41 56 43 56" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            {/* Three stacked canopy tiers — the silhouette that separates a TREE from a pot plant */}
            <path d="M32 6L46 24H18Z" fill="url(#treeCanopyGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M32 16L50 36H14Z" fill="url(#treeCanopyGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M32 26L54 44H10Z" fill="url(#treeCanopyGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <circle cx="24" cy="34" r="2.5" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.2" />
            <circle cx="41" cy="39" r="2.5" fill="#F87171" stroke={strokeColor} strokeWidth="1.2" />
          </svg>
        );

      // 廚房衛浴 —— 跟 `cabinets`（收納櫃）拆開。水龍頭與水槽，講的是「有水的那一間」。
      case 'kitchen_bath':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="kbBasinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#CBD5E1" />
              </linearGradient>
            </defs>
            {/* Tap */}
            <path d="M20 30V18C20 14 24 12 30 12C36 12 40 14 40 18V22" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
            <rect x="36" y="21" width="8" height="6" rx="2" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Water */}
            <path d="M40 29V36" stroke="#5FBDAF" strokeWidth="3" strokeLinecap="round" />
            <circle cx="40" cy="40" r="2" fill="#5FBDAF" />
            {/* Basin */}
            <path d="M10 38H54L50 54C50 55 49 56 48 56H16C15 56 14 55 14 54Z" fill="url(#kbBasinGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <rect x="8" y="34" width="48" height="5" rx="2.5" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Suds */}
            <circle cx="22" cy="46" r="4" fill="#FFFFFF" stroke={strokeColor} strokeWidth="1.5" />
            <circle cx="30" cy="49" r="3" fill="#FFFFFF" stroke={strokeColor} strokeWidth="1.5" />
            <circle cx="16" cy="26" r="2.5" fill="#FFFFFF" stroke={strokeColor} strokeWidth="1.2" />
          </svg>
        );

      // 庭園小物 —— 跟 `decorations`（室內擺件）拆開。柵欄與火把，架上就是這一類東西。
      case 'garden_props':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="gpFenceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#E2E8F0" />
              </linearGradient>
            </defs>
            {/* Picket fence */}
            <path d="M10 34L14 28L18 34V54H10Z" fill="url(#gpFenceGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M22 34L26 28L30 34V54H22Z" fill="url(#gpFenceGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M34 34L38 28L42 34V54H34Z" fill="url(#gpFenceGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M8 40H44M8 48H44" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            {/* Torch behind it */}
            <path d="M52 54V30" stroke="#8B5A2B" strokeWidth="5" strokeLinecap="round" />
            <path d="M52 30V54" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M52 10C57 17 57 20 57 23C57 27 55 29 52 29C49 29 47 27 47 23C47 20 47 17 52 10Z" fill="#FBBF24" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M52 17C54 21 54 22 54 23.5C54 25 53 26 52 26C51 26 50 25 50 23.5C50 22 50 21 52 17Z" fill="#F87171" />
            {/* Grass tuft */}
            <path d="M20 56C20 52 23 50 24 54M28 56C28 51 32 50 32 55" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      // 互動物件 —— 跟兩個「裝飾」拆開。鞦韆：這一架的東西是**走近會出現操作提示**的，
      // 而一個掛在繩子上、明顯要用身體去用的東西，是這件事最短的說法。
      case 'interactive':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="ivSeatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F5D0A9" />
                <stop offset="100%" stopColor="#C68E5A" />
              </linearGradient>
            </defs>
            {/* A-frame */}
            <path d="M10 56L20 12M54 56L44 12" stroke="#8B5A2B" strokeWidth="5" strokeLinecap="round" />
            <path d="M10 56L20 12M54 56L44 12" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
            {/* Cross beam */}
            <rect x="14" y="9" width="36" height="6" rx="3" fill="#A16207" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Ropes */}
            <path d="M25 15V38M39 15V38" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />
            {/* Seat */}
            <rect x="20" y="37" width="24" height="7" rx="3" fill="url(#ivSeatGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Motion arcs — it is a thing you DO something with */}
            <path d="M14 30C11 33 10 37 10 41" stroke="#5FBDAF" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M50 30C53 33 54 37 54 41" stroke="#5FBDAF" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        );

      // 寵物窩 —— 跟 `beds`（臥室的床）拆開。這一格逛在【寵物】、放在【室外】，所以它會出現在
      // 島上的建造抽屜裡；跟一張雙人床用同一張圖，玩家會以為自己在買家具。
      case 'pet_home':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="phRoofGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#F87171" />
                <stop offset="100%" stopColor="#B91C1C" />
              </linearGradient>
              <linearGradient id="phBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F5D0A9" />
                <stop offset="100%" stopColor="#C68E5A" />
              </linearGradient>
            </defs>
            {/* Kennel body */}
            <path d="M14 30H50V54H14Z" fill="url(#phBodyGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Roof */}
            <path d="M32 8L56 32H8Z" fill="url(#phRoofGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Arched doorway */}
            <path d="M24 54V42C24 37 28 34 32 34C36 34 40 37 40 42V54Z" fill="#3D2A1C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Bone on the step */}
            <path d="M44 50h6" stroke="#FFFBEB" strokeWidth="4" strokeLinecap="round" />
            <circle cx="44" cy="48.5" r="2" fill="#FFFBEB" stroke={strokeColor} strokeWidth="1.2" />
            <circle cx="44" cy="51.5" r="2" fill="#FFFBEB" stroke={strokeColor} strokeWidth="1.2" />
            <circle cx="50" cy="48.5" r="2" fill="#FFFBEB" stroke={strokeColor} strokeWidth="1.2" />
            <circle cx="50" cy="51.5" r="2" fill="#FFFBEB" stroke={strokeColor} strokeWidth="1.2" />
          </svg>
        );

      // 大型裝置 —— 跟 `artwork`（室內藝術品）拆開。差別是**尺寸**：這一架是圖騰、拱門、動態
      // 雕塑，站在地上而不是掛在牆上，所以畫的是一座人比它矮的拱門。
      case 'art_outdoor':
        return (
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <linearGradient id="aoStoneGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#CBD5E1" />
                <stop offset="100%" stopColor="#64748B" />
              </linearGradient>
            </defs>
            {/* Ground line */}
            <path d="M6 54H58" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
            {/* Standing arch */}
            <path d="M14 54V28C14 18 22 10 32 10C42 10 50 18 50 28V54H40V28C40 23 36 20 32 20C28 20 24 23 24 28V54Z" fill="url(#aoStoneGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Carved bands, so it reads as worked stone rather than a plain gateway */}
            <path d="M14 36H24M40 36H50" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M14 45H24M40 45H50" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" />
            {/* Suspended mobile piece under the arch */}
            <path d="M32 20V30" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="32" cy="34" r="4.5" fill="#E8AA3E" stroke={strokeColor} strokeWidth={strokeWidth} />
            <circle cx="32" cy="34" r="1.5" fill="#FFFBEB" />
          </svg>
        );

      default:
        break;
    }
  }

  const wrapLegacyIcon = (content: React.ReactNode, originalSize: number = 160) => {
    const scale = size / originalSize;
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative'
        }}
        className={className}
      >
        <div 
          style={{ 
            transform: `scale(${scale})`, 
            transformOrigin: 'center', 
            width: originalSize, 
            height: originalSize, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            flexShrink: 0 
          }}
        >
          {content}
        </div>
      </div>
    );
  };

  const hairSpec = getHairSpec(currentId);
  if (hairSpec) {
    // Silhouette and colour both come from the same HairSpec the 3D avatar renders,
    // so this preview cannot show the player something they won't get. Only the
    // flat-art shading (highlights, strand lines) is authored here.
    //
    // Drawn as a front-facing portrait rather than a stack of tinted blocks: at the
    // 40-110px this renders at, the OUTLINE is what a player reads first, so each
    // tier gets its own - chin-length bob, shoulder C-curl, blunt straight fall,
    // scalloped waves, jagged crest. The previous art gave every style the same
    // rounded slab, which made 黑長直 in particular land as one black rectangle.
    const { color, silhouette } = hairSpec;

    // Shading is derived from the spec colour, never authored per style, so a new
    // HAIR_SPECS entry gets readable highlights for free.
    const { top, shine, shineSoft, deep } = shadeFrom(color);
    const gradId = `hairGrad-${hairSpec.id}`;

    const hairFill = `url(#${gradId})`;
    const defs = (
      <linearGradient id={gradId} x1="0%" y1="0%" x2="18%" y2="100%">
        <stop offset="0%" stopColor={top} />
        <stop offset="55%" stopColor={color} />
        <stop offset="100%" stopColor={deep} />
      </linearGradient>
    );

    // The hair ALONE - no bust, no face. The shop is selling a hairstyle, so the thumbnail is a
    // hairstyle: a wig seen head-on, with the face left as a hole punched through it.
    //
    // That hole is doing the work the face used to. Hair drawn against empty space is an
    // ambiguous blob, but hair wrapped around a face-shaped gap is unmistakably hair - it is the
    // same negative space a wig on a shelf has, and every character creator reads this way. It
    // also hands the whole frame back to the silhouette, which is the thing that identifies the
    // style; the old bust and head were spending about a third of the icon on parts that were
    // identical in all five thumbnails and so told the player nothing.
    const faceCutId = `hairFaceCut-${hairSpec.id}`;

    const wig = (backHair: React.ReactNode, frontHair: React.ReactNode) => (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <defs>
          {defs}
          {/* Only the mass BEHIND the face is cut. The fringe is painted over the opening
              afterwards, which is exactly how a fringe behaves. */}
          <mask id={faceCutId}>
            <rect x="0" y="0" width="64" height="64" fill="#fff" />
            <ellipse cx="32" cy="30.5" rx="10.4" ry="13" fill="#000" />
          </mask>
        </defs>
        {/* Sits inside the opening, so the gap reads as the hollow of a wig rather than as a
            hole in the artwork. Neutral and translucent - it must not imply a skin tone. */}
        <ellipse cx="32" cy="30.5" rx="10.4" ry="13" fill={strokeColor} opacity="0.07" />
        <g mask={`url(#${faceCutId})`}>{backHair}</g>
        {frontHair}
      </svg>
    );

    switch (silhouette) {
      // Chin-length bob with a side-swept fringe. The hem is cut into a V of uneven
      // points rather than left as one straight line: 層次剪 is what the 3D model
      // now grows at the nape, and a flat hem was most of what made this the
      // dullest thumbnail in the shop.
      case 'short':
        return wig(
          <>
            <path
              d="M16.5 32C16.5 19 23 10.5 32 10.5C41 10.5 47.5 19 47.5 32V41.5C47.5 45.5 43.8 47 42.6 43.8L41.2 38.4L38.6 43.6L36 39.4H28L25.4 43.6L22.8 38.4L21.4 43.8C20.2 47 16.5 45.5 16.5 41.5V32Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* Strand relief down the sides, where the mass is actually visible past
                the face opening. Uneven lengths, for the same reason the model's are. */}
            <path d="M19.4 29.5C19.1 34 19.5 38.4 20.5 41.6M22.8 32.5C22.6 35.8 23 38.6 23.8 40.8"
              stroke={shineSoft} strokeWidth="1.4" strokeLinecap="round" fill="none" />
            <path d="M44.6 29.5C44.9 34 44.5 38.4 43.5 41.6M41.2 32.5C41.4 35.8 41 38.6 40.2 40.8"
              stroke={shineSoft} strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </>,
          <>
            <path
              d="M18.6 27.8C18.6 17 24.6 10.5 32 10.5C39.8 10.5 45.8 17 45.8 27.5C43.2 23.2 39.6 20.7 35.2 20.2C33.6 23.8 30 26.7 25.6 27.7C23.2 28.2 20.7 28.2 18.6 27.8Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            <path d="M23.5 18.5C26 15 29.5 13.2 33 13.5" stroke={shine} strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M43.6 30.5C44.6 33.6 44.8 36.8 44.2 39.6" stroke={shineSoft} strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </>
        );

      // Shoulder-length with inward C-curl tips and curtain bangs. Three tiers of
      // layering in the model, so three depths of point in the hem here.
      case 'mid':
        return wig(
          <>
            <path
              d="M16 32C16 19 22.5 10.5 32 10.5C41.5 10.5 48 19 48 32V45.5C48 51 45.2 54.5 41.4 54.5C38.2 54.5 37 51.6 38.8 49.6C41 47.2 41.8 43.8 41.6 39.5H22.4C22.2 43.8 23 47.2 25.2 49.6C27 51.6 25.8 54.5 22.6 54.5C18.8 54.5 16 51 16 45.5V32Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* A SHORTER LAYER hanging in front of each fall, outlined so it separates
                from the length behind it. This is what 層次 looks like head-on, and it
                has to be drawn as its own piece: a notched hem would sit behind the
                face opening, where nothing of it survives but the points. */}
            <path
              d="M41.4 23.6C45 28 45.8 33.8 45.4 39.8C45.2 43.2 44.4 45.8 43.2 47.8C42.4 49.2 40.4 48.6 40.2 46.8C39.6 41.6 40.2 29.6 41.4 23.6Z"
              fill={hairFill} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round"
            />
            <path
              d="M22.6 23.6C19 28 18.2 33.8 18.6 39.8C18.8 43.2 19.6 45.8 20.8 47.8C21.6 49.2 23.6 48.6 23.8 46.8C24.4 41.6 23.8 29.6 22.6 23.6Z"
              fill={hairFill} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round"
            />
            {/* Strand relief down both falls. Uneven ends, so the mass reads as hair
                hanging in pieces rather than as two moulded slabs. */}
            <path d="M18.8 33C18.2 38 18.4 43 19.6 47.4M21.8 35C21.4 39.2 21.6 43 22.4 46"
              stroke={shineSoft} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M45.2 33C45.8 38 45.6 43 44.4 47.4M42.2 35C42.6 39.2 42.4 43 41.6 46"
              stroke={shineSoft} strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </>,
          <>
            <path
              d="M19 27.5C19 17 24.6 10.5 32 10.5C39.4 10.5 45 17 45 27.5C43.8 21.6 39.8 17.6 34.4 16.6C33.9 20.2 33.2 22.8 32 24.8C30.8 22.8 30.1 20.2 29.6 16.6C24.2 17.6 20.2 21.6 19 27.5Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            <path d="M23 20.5C25 17 28 14.8 31 14.4" stroke={shine} strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M19.6 34C18.9 38.5 19.1 43 20.5 46.5" stroke={shineSoft} strokeWidth="1.8" strokeLinecap="round" fill="none" />
            <path d="M44.4 34C45.1 38.5 44.9 43 43.5 46.5" stroke={shineSoft} strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </>
        );

      // 黑長直: blunt one-length fall, straight sides, flat hem. The gloss ring and
      // the side locks are what stop a near-black fill reading as a silhouette.
      case 'long':
        return wig(
          <>
            <path
              d="M17 32C17 18.5 23.5 10 32 10C40.5 10 47 18.5 47 32V55C47 56.7 45.9 57.8 44.2 57.8H19.8C18.1 57.8 17 56.7 17 55V32Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* 髮絲: many fine lines at uneven heights, NOT a stepped hem. The cut is
                一刀齊, so the layering the other long styles get would be the wrong
                haircut - here the relief has to do all the work on its own, which is
                why there is roughly three times as much of it as before. */}
            <path d="M20.4 37V55M23.6 41V55M26.8 44V55M30 46V55M34 46V55M37.2 44V55M40.4 41V55M43.6 37V55"
              stroke={shineSoft} strokeWidth="1.3" strokeLinecap="round" />
            <path d="M22 34.5V40M28.4 39V44.5M35.6 39V44.5M42 34.5V40"
              stroke={shine} strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />
            <path d="M18.6 53.5H45.4" stroke={deep} strokeWidth="2" strokeLinecap="round" />
          </>,
          <>
            <path
              d="M19 25.8C19 15.4 24.8 9.4 32 9.4C39.2 9.4 45 15.4 45 25.8C42.4 24.4 39.8 25.8 37 24.9C34.6 25.8 32.4 24.6 29.4 25.5C26.4 24.5 23 26 19 25.8Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* Side locks framing the face — the signature of a hime-style cut */}
            <path d="M20.4 24L19.4 45C19.3 46.9 22.6 46.9 22.7 45L23.4 24H20.4Z" fill={hairFill} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M43.6 24L44.6 45C44.7 46.9 41.4 46.9 41.3 45L40.6 24H43.6Z" fill={hairFill} stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M22.5 21.5C25 16.4 28.4 13.8 32 13.8C35.6 13.8 39 16.4 41.5 21.5" stroke={shine} strokeWidth="3" strokeLinecap="round" fill="none" />
          </>
        );

      // 大波浪: same length as 'long', scalloped outline and curl ripples instead of
      // a straight hem — the outline difference, not the hue, is what identifies it.
      case 'wave':
        return wig(
          <>
            <path
              d="M16 32C16 18.5 23 10 32 10C41 10 48 18.5 48 32C48 36.6 45.8 38.6 47.4 42.6C49 46.6 46.4 48.6 47 52.4C47.5 55.8 44 58.2 41.4 55.6C39.4 53.6 41 51 40.6 47.6C40.2 43.8 41.6 41.8 41.2 39H22.8C22.4 41.8 23.8 43.8 23.4 47.6C23 51 24.6 53.6 22.6 55.6C20 58.2 16.5 55.8 17 52.4C17.6 48.6 15 46.6 16.6 42.6C18.2 38.6 16 36.6 16 32Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* 前短後長 / V字剪: a shorter curled layer hanging in front of each fall,
                outlined so it reads as a separate length rather than as shading. The
                curl on it is tighter than the one on the mass behind, which is what
                layered waves actually do. */}
            <path
              d="M41.4 23.4C44.8 27 45.8 31.6 45 35.8C44.2 39.6 45.6 42 44.4 45.2C43.4 47.8 41.6 49.6 40.4 48.2C39.2 46.8 40.4 44.6 40.2 41.6C39.9 37 40.6 28.6 41.4 23.4Z"
              fill={hairFill} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round"
            />
            <path
              d="M22.6 23.4C19.2 27 18.2 31.6 19 35.8C19.8 39.6 18.4 42 19.6 45.2C20.6 47.8 22.4 49.6 23.6 48.2C24.8 46.8 23.6 44.6 23.8 41.6C24.1 37 23.4 28.6 22.6 23.4Z"
              fill={hairFill} stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round"
            />
            <path d="M20.5 38C22.5 41 20 43.5 22 46.5C23.6 49 21.6 51 22.4 53.5" stroke={shineSoft} strokeWidth="1.6" strokeLinecap="round" fill="none" />
            <path d="M43.5 38C41.5 41 44 43.5 42 46.5C40.4 49 42.4 51 41.6 53.5" stroke={shineSoft} strokeWidth="1.6" strokeLinecap="round" fill="none" />
            {/* The S itself, said inside the mass as well as on its edge. The model
                now builds each back lock out of segments that swing alternately out
                and back, and these are the same curve seen head-on: the swing grows
                downward, because that is where a wave actually opens up. */}
            <path d="M24.6 33C26.4 36 24.2 38.6 26 41.6C27.8 44.6 25.4 47.4 27.2 50.6"
              stroke={shineSoft} strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.5" />
            <path d="M39.4 33C37.6 36 39.8 38.6 38 41.6C36.2 44.6 38.6 47.4 36.8 50.6"
              stroke={shineSoft} strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.5" />
          </>,
          <>
            <path
              d="M18.6 28C18.6 16.6 24.6 10 32 10C40 10 46 16.6 46 27.2C44.4 22 41 18.6 36 17.6C35 21.6 31 25.6 26 27.1C23 28 20.6 28.2 18.6 28Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            <path d="M23 21.5C25.5 17.5 29 15 33 14.6" stroke={shine} strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <path d="M25.5 25C28.5 23 31 20.6 32.5 18" stroke={shineSoft} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            {/* Sparkle. It read as moonlight when the style was silver; on black it earns its
                keep differently, as the one warm accent stopping a dark fill going inert. */}
            <path d="M50 16L51.2 19.4L54.6 20.6L51.2 21.8L50 25.2L48.8 21.8L45.4 20.6L48.8 19.4L50 16Z" fill="#FDE68A" stroke={strokeColor} strokeWidth="1.2" strokeLinejoin="round" />
          </>
        );

      // 短髮內彎 - a chin-length bob whose hem turns UNDER. It shares a length with 'short' and a
      // C-curl with 'mid', so neither of those on its own would identify it. The tuck is what
      // does: the outline's widest point sits ABOVE the hem and the sides swing back in toward
      // the jaw, where every other style here is at its widest where it ends.
      case 'bob-in':
        return wig(
          <>
            {/* 整體飽滿 is half of what a bob IS - the mass is fuller and rounder than
                the other short styles, and its widest point sits high, above the tuck.
                The other half is that the layering is ENDS-ONLY (通常只有在髮尾會有層次):
                the crown is left as one smooth unbroken curve on purpose, and every
                step in the outline happens in the last few units before the tip. Cut
                the layers further up and this stops being a bob. */}
            <path
              d="M15.2 31.4C15.2 18.2 22.4 9.9 32 9.9C41.6 9.9 48.8 18.2 48.8 31.4C48.8 36.6 48.2 40.8 46.6 44.2C45.1 47.6 40.7 49.2 38.1 47C35.6 44.9 37.8 41.8 39.8 40.8C41.4 40 42 38.2 41.8 35.6H22.2C22 38.2 22.6 40 24.2 40.8C26.2 41.8 28.4 44.9 25.9 47C23.3 49.2 18.9 47.6 17.4 44.2C15.8 40.8 15.2 36.6 15.2 31.4Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* The layered ends themselves: short tips peeling off each hook, only at
                the hem. This is the 層次 the cut actually has. */}
            <path d="M20.2 43.4C20.9 45.6 22.2 47.2 24 48"
              stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.5" />
            <path d="M43.8 43.4C43.1 45.6 41.8 47.2 40 48"
              stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.5" />
            {/* The tuck said twice - the outline hooks and the strand lines hook with
                it, curling toward the jaw rather than falling straight. */}
            <path d="M19.4 32.6C19 37.4 20 41.6 22.6 44.4" stroke={shineSoft} strokeWidth="1.7" strokeLinecap="round" fill="none" />
            <path d="M22.6 34.6C22.4 38.4 23.2 41.4 25 43.4" stroke={shineSoft} strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.7" />
            <path d="M44.6 32.6C45 37.4 44 41.6 41.4 44.4" stroke={shineSoft} strokeWidth="1.7" strokeLinecap="round" fill="none" />
            <path d="M41.4 34.6C41.6 38.4 40.8 41.4 39 43.4" stroke={shineSoft} strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.7" />
          </>,
          <>
            {/* Soft full fringe dipping at the centre - 空氣瀏海, not a blunt cut, which also
                keeps it from colliding with 'short''s side-swept sweep. */}
            <path
              d="M18.8 28.4C18.8 17.4 24.6 10.2 32 10.2C39.4 10.2 45.2 17.4 45.2 28.4C44 25.4 42.4 23.4 40.4 22.2C38.4 24.6 35.4 25.9 32 25.9C28.6 25.9 25.6 24.6 23.6 22.2C21.6 23.4 20 25.4 18.8 28.4Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            <path d="M23.4 20.4C25.8 16.4 28.8 14.2 32 14" stroke={shine} strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </>
        );

      // 美式前刺 - clippered sides against a forward-raked fan on top. Seen head-on the rake
      // reads as height plus splay, so the fan is drawn tallest at the centre with the outer
      // spikes leaning out past the skull's own width. The sides get the same clipper texture
      // the punk crest uses, but over hair colour rather than bare skin: here the sides are
      // SHORT, not shaved, and that difference is most of what separates this from 'crest'.
      case 'spike':
        return wig(
          <path
            d="M17.8 32C17.8 19.6 24.2 11.6 32 11.6C39.8 11.6 46.2 19.6 46.2 32V38.4C46.2 41.4 44.8 43 42.8 43C40.8 43 39.8 41.4 39.8 38.8V33H24.2V38.8C24.2 41.4 23.2 43 21.2 43C19.2 43 17.8 41.4 17.8 38.4V32Z"
            fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />,
          <>
            <path
              d="M20.6 34.4L21.4 31.8M22.4 28.4L23.6 26M25.2 22.6L26.8 20.8M43.4 34.4L42.6 31.8M41.6 28.4L40.4 26M38.8 22.6L37.2 20.8"
              stroke={shine} strokeWidth="1.6" strokeLinecap="round" opacity="0.55"
            />
            {/* The serration sits ON the crown's own arc: the valleys follow the dome and only
                the tips leave it. Drawn instead as tall fingers off a flat base - which is the
                obvious way to draw spikes - it came out as a feathered headdress, because
                nothing in the outline was still reading as a head. */}
            {/* The tips deliberately DISAGREE - no two the same height, and the two
                halves no longer mirror each other. The old fan was perfectly
                symmetrical with evenly stepped teeth, which is a comb or a crown,
                not hair pinched out with wax. The 3D model jitters the same way. */}
            <path
              d="M17.9 30C17.9 25.8 18.3 24 19 22.7L18.6 15.4L22 16.9L22.8 7.2L26.4 12.8L28.6 4.6L31.4 10.8L34.8 6.2L37.4 12.2L41.2 9.2L42.2 15.6L45.4 13.4L45 22.7C45.7 24 46.1 25.8 46.1 30C40 25 24 25 17.9 30Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* One lit half and one shaded, so the fan has thickness instead of reading as a
                flat paper cut-out - the same trick the crest uses. */}
            <path d="M31.4 10.8L34.8 6.2L37.4 12.2L41.2 9.2L42.2 15.6L45.4 13.4L45 22.7C45.7 24 46.1 25.8 46.1 30C42 26.8 37 25.4 31.4 25.2Z" fill={deep} opacity="0.3" />
            {/* Kept short and low. Run the full height of a spike and they stop being highlights
                and start being quills, which was most of what made the first pass a headdress. */}
            <path d="M29.4 20.6L29.1 16.2M24.5 21.2L24.3 17.6" stroke={shine} strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
            <path d="M34.6 20.6L34.9 16.6" stroke={shineSoft} strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          </>
        );

      // 渣男燙 - the one style sold on TEXTURE rather than length, so the silhouette is built
      // OUT of the texture instead of being a smooth edge with curls drawn inside it. At 40px an
      // interior pattern is mush; a broken edge is the only thing that reliably separates a
      // perm from a bob of the same length.
      //
      // But the texture is BUNDLES, not balls. A 錫紙燙 is made by 把髮絲擰轉成束 - twisting
      // hair into ropes and setting them - so what it looks like is dense twisted rope lying
      // every which way. Drawn as a ring of circles, which is what this was, it came out as
      // bubble wrap: circles have no direction, and direction is the entire look.
      //
      // So each piece is an ellipse laid along the skull's TANGENT where it sits - flat across
      // the crown, hanging by the time it reaches the jaw - and then argued with by a fixed
      // per-piece jitter, because a perm that agrees with itself is a helmet.
      case 'perm': {
        /** Stable per-piece noise. Same trick and same reason as the 3D layout's. */
        const rnd = (i: number) => {
          const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
          return x - Math.floor(x);
        };
        // Deliberately kept inside the same head-sized envelope every other thumbnail
        // uses. 蓬 is the selling point, but a mass that outgrows the head stops
        // reading as a haircut - the first pass at this reached r=21 and came out as
        // a walnut. The bundles are small and MANY instead, which is also the truer
        // description of the cut: 紋路很密.
        const bundles = [
          { r: 14.6, n: 17, rx: 5.4, ry: 2.9 },
          { r: 10.2, n: 13, rx: 5.0, ry: 2.7 },
          { r: 5.6, n: 9, rx: 4.6, ry: 2.6 },
          { r: 1.2, n: 4, rx: 4.2, ry: 2.5 },
        ].flatMap(({ r, n, rx, ry }, k) =>
          Array.from({ length: n }, (_, i) => {
            // Half a slot of offset on alternate rings, so the bundles interlock
            // instead of lining up into spokes.
            const th = (i / n) * Math.PI * 2 + (k * Math.PI) / n;
            const j = rnd(k * 31 + i);
            const dy = r * Math.cos(th);
            return {
              cx: 32 + r * Math.sin(th) * 1.04,
              // Squashed below the ears: the volume of this cut sits up on the crown,
              // and a perfectly round mass would read as an afro.
              cy: 28.6 - (dy > 0 ? dy : dy * 0.78),
              rx: rx * (0.8 + 0.34 * j),
              ry,
              // Tangential, plus this bundle's own disagreement with its neighbours.
              a: (th * 180) / Math.PI + (j - 0.5) * 48,
            };
          }),
        );
        // Backs the bundles so no gap between them can show through to the page.
        const base =
          'M17.4 31C17.4 18.6 24 10.4 32 10.4C40 10.4 46.6 18.6 46.6 31V39.6C46.6 44.8 43.4 47.6 39.4 46.8C36.6 46.2 36.6 42.6 39 41.8C41 41.2 41.8 39.2 41.6 36H22.4C22.2 39.2 23 41.2 25 41.8C27.4 42.6 27.4 46.2 24.6 46.8C20.6 47.6 17.4 44.8 17.4 39.6V31Z';
        // Doubled because the fill pass covers the inner half of every stroke; this leaves the
        // union's outer edge at the same visual weight as every other icon's outline.
        const unionStroke = String(Number(strokeWidth) * 2);
        const rope = (b: { cx: number; cy: number; rx: number; ry: number; a: number }, key: string) => (
          <ellipse
            key={key} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry}
            transform={`rotate(${b.a.toFixed(1)} ${b.cx.toFixed(2)} ${b.cy.toFixed(2)})`}
          />
        );
        // A row of evenly spaced pieces across the brow reads as a pair of sunglasses,
        // however many of them there are - it is the EVENNESS that does it. So these
        // are swept off one side the way the cut is actually worn: no two share a
        // size, a height or a tilt, and they crowd to the left and thin out right.
        const fringe = [
          { cx: 23.4, cy: 23, rx: 4.4, ry: 2.6, a: 52 },
          { cx: 26.4, cy: 18.8, rx: 4.6, ry: 2.7, a: 18 },
          { cx: 31.6, cy: 17.6, rx: 4.2, ry: 2.5, a: -4 },
          { cx: 38.4, cy: 20.2, rx: 4.8, ry: 2.6, a: -30 },
        ];
        return wig(
          <>
            <g stroke={strokeColor} strokeWidth={unionStroke} fill="none" strokeLinejoin="round">
              <path d={base} />
              {bundles.map((b, i) => rope(b, `s${i}`))}
            </g>
            <g fill={hairFill}>
              <path d={base} />
              {bundles.map((b, i) => rope(b, `f${i}`))}
            </g>
            {/* A single soft stroke along each rope, and only on some of them. Given to
                every bundle as a double S it turned the mass into brain coral: at this
                size the outlines are ALREADY saying "twisted", and a highlight on top of
                every one of them just competes with them. */}
            <g stroke={shineSoft} strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.42">
              {bundles.map((b, i) =>
                rnd(i * 7 + 1) < 0.55 ? null : (
                  <path
                    key={`t${i}`}
                    d={`M${(-b.rx * 0.5).toFixed(2)} ${(b.ry * 0.2).toFixed(2)}q${(b.rx * 0.5).toFixed(2)} ${(-b.ry * 0.85).toFixed(2)} ${(b.rx * 1).toFixed(2)} 0`}
                    transform={`translate(${b.cx.toFixed(2)} ${b.cy.toFixed(2)}) rotate(${b.a.toFixed(1)})`}
                  />
                ),
              )}
            </g>
          </>,
          <>
            {/* Twisted fringe. Same two-pass union, so it merges with the mass behind it,
                and the pieces are deliberately not evenly spaced or evenly angled. */}
            <g stroke={strokeColor} strokeWidth={unionStroke} fill="none">
              {fringe.map((b, i) => rope(b, `fs${i}`))}
            </g>
            <g fill={hairFill}>
              {fringe.map((b, i) => rope(b, `ff${i}`))}
            </g>
            <g stroke={shine} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.7">
              {fringe.map((b, i) => (
                <path
                  key={`ft${i}`}
                  d={`M${(-b.rx * 0.5).toFixed(2)} ${(b.ry * 0.2).toFixed(2)}q${(b.rx * 0.5).toFixed(2)} ${(-b.ry * 0.85).toFixed(2)} ${(b.rx * 1).toFixed(2)} 0`}
                  transform={`translate(${b.cx} ${b.cy}) rotate(${b.a})`}
                />
              ))}
            </g>
          </>
        );
      }

      // 吋頭 - like the punk crest, this style's identity is an ABSENCE, and it needs the same
      // answer: filled in solid it is just a very small bob. So the skull is the icon's
      // established neutral 7% "head-shaped absence" and the hair is a stipple laid over it,
      // which is what "推到見頭皮" actually looks like. The hairline is the other half of the
      // read - it is the only edge a buzz cut has, so it gets a real widow's peak rather than
      // being left as the rim of a dome.
      case 'buzz': {
        // Deliberately the tightest silhouette in the set. 短髮系列 is also a dark rounded mass,
        // and at 40px the speckle that separates them has gone - so the difference has to be
        // carried by how close the outline sits to the skull, which is the true claim anyway.
        const cap =
          'M19.4 30.4C19.4 18.6 25 11.6 32 11.6C39 11.6 44.6 18.6 44.6 30.4C44.6 38 40 42.4 32 42.4C24 42.4 19.4 38 19.4 30.4Z';
        const band =
          'M20.9 23C20.9 15.2 25.8 11.6 32 11.6C38.2 11.6 43.1 15.2 43.1 23C42 22.3 40.5 22.1 38.6 22.5C36.3 23 34.4 24.6 32 24.8C29.6 24.6 27.7 23 25.4 22.5C23.5 22.1 22 22.3 20.9 23Z';
        const capClip = `buzzCap-${hairSpec.id}`;
        const bandClip = `buzzBand-${hairSpec.id}`;
        // Concentric rings of dots rather than a random scatter: clippered hair grows in an
        // even pile, and an even pile is also what keeps the texture legible when the icon is
        // scaled down to 40px.
        const stubble: Array<[number, number]> = [];
        for (let ring = 0; ring < 6; ring++) {
          const rr = 2.8 + ring * 4.1;
          const count = 5 + ring * 6;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + ring * 0.55;
            stubble.push([32 + rr * Math.sin(a) * 1.02, 27.5 - rr * Math.cos(a) * 0.94]);
          }
        }
        // Speckled LIGHT, not dark. Drawn as dark dots over a washed-out fill the cap read as a
        // dirty swim hat; scalp glinting through dark stubble is both what a 吋頭 actually looks
        // like and the only way the texture survives the hair staying its real colour.
        const dots = (clip: string) => (
          <g clipPath={`url(#${clip})`}>
            {stubble.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="0.8" fill={shine} opacity="0.34" />)}
          </g>
        );
        return wig(
          <>
            <defs>
              <clipPath id={capClip}><path d={cap} /></clipPath>
            </defs>
            <path d={cap} fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {dots(capClip)}
            {/* Clipper arcs. Two curves following the skull are what say the length is uniform
                all over, which is the whole claim 吋頭 makes. */}
            <path d="M21.4 24.6C25.6 21.6 38.4 21.6 42.6 24.6M19.8 32.4C24.8 28.8 39.2 28.8 44.2 32.4"
              stroke={shine} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.3" />
          </>,
          <>
            <defs>
              <clipPath id={bandClip}><path d={band} /></clipPath>
            </defs>
            <path d={band} fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {dots(bandClip)}
            {/* Sideburns. The only part of a buzz cut that drops below the hairline, and the
                detail that separates a haircut from a cap pulled onto a head. */}
            <path d="M21.2 33.4C21.6 37.2 22.3 40.2 23.4 42.4C24 43.6 22.2 44.2 21.4 43C20 40.6 19.5 37.2 19.4 33.4Z"
              fill={hairFill} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M42.8 33.4C42.4 37.2 41.7 40.2 40.6 42.4C40 43.6 41.8 44.2 42.6 43C44 40.6 44.5 37.2 44.6 33.4Z"
              fill={hairFill} stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
          </>
        );
      }

      // 龐克髮型 - the only style here whose identity is a CONTRAST rather than an outline: a bare
      // skull either side of one standing strip. That makes it the odd one out in a hair-only set,
      // because the bare part is the thing you are buying and yet it is not hair. The previous
      // attempt drew the shaved area as a faint dome, which just read as a second, weaker hairstyle
      // sitting behind a small flame.
      //
      // So the two halves are split by what they ARE. The skull is drawn in the same neutral 7% as
      // the face opening - it is the icon's established way of saying "head-shaped absence", and
      // continuing it here is what explains the emptiness instead of leaving it looking unfinished.
      // The buzzed stubble on top of it is real hair and so is drawn in the real hair colour.
      //
      // And the crest is much bigger than before: base widened from 11 to 15 units and the tips
      // taken to y=2, because at 40px a short crest collapses into a bump on a head. It has to
      // out-mass everything else in the frame before it reads as punk.
      case 'crest':
        return wig(
          // Masked, so the face opening cuts it exactly as it cuts every other style's back mass.
          // Union with the helper's own face ellipse gives one even 7% skull.
          <path
            d="M18.5 31C18.5 18 24.6 10.5 32 10.5C39.4 10.5 45.5 18 45.5 31C45.5 40 39.5 45 32 45C24.5 45 18.5 40 18.5 31Z"
            fill={strokeColor} opacity="0.07"
          />,
          <>
            {/* Buzzed sides. Short strokes following the skull, not a wash: clippered hair reads as
                texture, and texture is also what stops the bare half looking like a drawing error. */}
            <path
              d="M20.9 30.6L21.7 28.3M22.4 25.4L23.6 23.4M24.8 21L26.4 19.4M43.1 30.6L42.3 28.3M41.6 25.4L40.4 23.4M39.2 21L37.6 19.4"
              stroke={color} strokeWidth="1.7" strokeLinecap="round" opacity="0.7"
            />
            <path
              d="M25 26L26.5 12L28 17L29.5 6L30.8 14L32 2L33.2 14L34.5 6L36 17L37.5 12L39 26C36 24 28 24 25 26Z"
              fill={hairFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
            />
            {/* One lit face and one shaded face, so the strip has a thickness instead of reading as
                a flat paper cut-out. */}
            <path d="M32 2L33.2 14L34.5 6L36 17L37.5 12L39 26C37.4 24.9 34.9 24.3 32 24.2Z" fill={deep} opacity="0.35" />
            <path d="M29.4 22.5L30 9" stroke={shine} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M34.8 21.5L34.4 13" stroke={shineSoft} strokeWidth="1.4" strokeLinecap="round" />
          </>
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Hats. Each one is drawn as a product shot of the actual 3D model, in the model's
  // own colours (constants/hats.ts), with the ONE feature its Chinese name promises
  // made the largest thing in the frame:
  //
  //   草帽    the brim, absurdly wide - it is a sun hat, and width is the product
  //   漁夫帽  the brim angled DOWN all the way round, which is the whole cut
  //   貝雷帽  the tilt and the stalk; worn flat it is just a disc
  //   毛帽    the folded cuff and the white pompom
  //   平板帽  a dead straight brim - 帽簷平直不彎曲 is literally the description
  //
  // The old art was four Tailwind boxes that shared a rounded-rectangle crown and
  // differed mainly in hue, so at 40px the bucket hat and the snapback were the same
  // picture. Worse, the hues were invented here: the 3D 漁夫帽 is slate (#475569)
  // and its icon was `bg-stone-300`, a pale warm grey - a different hat.
  const hatPalette = getHatPalette(currentId);
  if (hatPalette) {
    const { body, trim = hatPalette.body, accent } = hatPalette;
    const bodyShade = shadeFrom(body);
    const trimShade = shadeFrom(trim);
    const gradId = `hatGrad-${currentId}`;
    const trimGradId = `hatTrim-${currentId}`;
    const bodyFill = `url(#${gradId})`;
    const trimFill = `url(#${trimGradId})`;

    const shell = (content: React.ReactNode) => (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="20%" y2="100%">
            <stop offset="0%" stopColor={bodyShade.top} />
            <stop offset="55%" stopColor={body} />
            <stop offset="100%" stopColor={bodyShade.deep} />
          </linearGradient>
          <linearGradient id={trimGradId} x1="0%" y1="0%" x2="20%" y2="100%">
            <stop offset="0%" stopColor={trimShade.top} />
            <stop offset="60%" stopColor={trim} />
            <stop offset="100%" stopColor={trimShade.deep} />
          </linearGradient>
        </defs>
        {content}
      </svg>
    );

    // 草帽 - the brim is drawn nearly frame-wide on purpose. In 3D it is r=0.45
    // against a r=0.26 crown, so a modest brim would be understating the actual
    // model as well as the point of a sun hat.
    if (currentId === 'item-5') {
      return shell(
        <>
          <path
            d="M20 43C20 26.4 23.8 17.2 32 17.2C40.2 17.2 44 26.4 44 43Z"
            fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          {/* Ribbon, sitting where the 3D model's #b91c1c band sits: at the crown base. */}
          <path
            d="M20.9 31.6C24.3 30.8 28 30.4 32 30.4C36 30.4 39.7 30.8 43.1 31.6L43.6 39.4C39.9 38.5 36.1 38.1 32 38.1C27.9 38.1 24.1 38.5 20.4 39.4Z"
            fill={accent} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round"
          />
          <path d="M4 44.4C4 39.9 16.5 36.6 32 36.6C47.5 36.6 60 39.9 60 44.4C60 49.2 47.5 52.6 32 52.6C16.5 52.6 4 49.2 4 44.4Z"
            fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Woven straw: rings on the brim, verticals on the crown. Texture is what keeps
              a big flat amber shape from reading as a plastic frisbee. */}
          <path d="M9.6 44.6C13.4 47.2 21.8 49 32 49C42.2 49 50.6 47.2 54.4 44.6M15.6 46.8C19.8 48.4 25.6 49.4 32 49.4C38.4 49.4 44.2 48.4 48.4 46.8"
            stroke={bodyShade.shineSoft} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.75" />
          <path d="M26 30.2C26.4 25.4 27.4 21.6 28.8 19M38 30.2C37.6 25.4 36.6 21.6 35.2 19"
            stroke={bodyShade.shine} strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M23.6 22.6C25.4 19.6 28.2 18 31.4 18" stroke={bodyShade.shine} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      );
    }

    // 漁夫帽 - straight-sided crown and a brim that slopes DOWN the whole way round.
    // Both come straight off the 3D cylinder pair; the downturn is the thing that
    // separates it from the straw hat's flat disc at any size.
    if (currentId === 'hat-bucket') {
      return shell(
        <>
          <path
            d="M20.4 38.4V24.6C20.4 18.6 25.4 14.6 32 14.6C38.6 14.6 43.6 18.6 43.6 24.6V38.4Z"
            fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          <path
            d="M19.4 36.4H44.6C44.6 36.4 51.4 41.6 54.4 45.2C56.8 48.2 54.8 51 50.4 51H13.6C9.2 51 7.2 48.2 9.6 45.2C12.6 41.6 19.4 36.4 19.4 36.4Z"
            fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          {/* Topstitching. A bucket hat is defined by its rows of stitching as much as by
              its shape, and the lines double as the cue that the brim is sloping away. */}
          <path d="M14.6 45.4C19.4 47.8 25.4 49 32 49C38.6 49 44.6 47.8 49.4 45.4"
            stroke={bodyShade.shineSoft} strokeWidth="1.3" strokeLinecap="round" fill="none" strokeDasharray="3 2.4" />
          <path d="M21.2 27.4C24.4 26.6 28 26.2 32 26.2C36 26.2 39.6 26.6 42.8 27.4"
            stroke={bodyShade.shineSoft} strokeWidth="1.3" strokeLinecap="round" fill="none" strokeDasharray="3 2.4" />
          <path d="M24 21.6C25.8 19 28.6 17.6 31.8 17.6" stroke={bodyShade.shine} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          {/* The one eyelet a bucket hat carries. */}
          <circle cx="40.4" cy="32.2" r="1.5" fill={bodyShade.deep} stroke={strokeColor} strokeWidth="1.1" />
        </>
      );
    }

    // 貝雷帽 - drawn tilted, because the 3D model is (rotation z 0.25) and because a
    // beret sitting level is indistinguishable from a plain disc. The overhang on the
    // low side plus the stalk are the whole identity.
    if (currentId === 'hat-beret') {
      // The tilt swings the puff's mass left, leaving the drawn shape centred on x=28.9
      // rather than 32. The translate nudges it back so the hat sits in its tile like
      // the other four.
      return shell(
        <g transform="rotate(-11 32 32) translate(3.1 0)">
          {/* Headband first, and deliberately much NARROWER than the puff. The overhang is
              the read: a beret is a disc too big for the head it is pinned to, and without
              that cantilever the icon was a dark egg. Lightened rather than shadowed,
              because on a maroon this dark a shadowed band is invisible at 40px. */}
          <path
            d="M22.4 35.6H45.6V41.4C45.6 45.2 40.4 47.6 34 47.6C27.6 47.6 22.4 45.2 22.4 41.4Z"
            fill={bodyShade.mix(0.22)} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          <path
            d="M9.6 32.4C9.6 21.2 19.6 13.2 32.6 13.2C44.2 13.2 52.6 19.6 52.6 27.2C52.6 33.4 47 37.6 38.6 38.9C36 39.3 33.2 39.5 30.2 39.5C17.4 39.5 9.6 37.2 9.6 32.4Z"
            fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          <ellipse cx="33.4" cy="14.4" rx="2.9" ry="2.5" fill={bodyShade.mix(0.3)} stroke={strokeColor} strokeWidth="1.9" />
          <path d="M15.6 28.6C18 21.8 23.8 17.4 31.4 16.6" stroke={bodyShade.shine} strokeWidth="2.8" strokeLinecap="round" fill="none" />
          <path d="M12.4 34.4C14.2 36.2 17.4 37.6 21.6 38.4" stroke={bodyShade.shineSoft} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </g>
      );
    }

    // 毛帽 - pompom first, because it is the silhouette break that identifies the hat
    // from across a grid, then the knit dome, then the folded cuff.
    if (currentId === 'hat-beanie') {
      return shell(
        <>
          <path
            d="M17.4 43.4C17.4 27.6 23.6 17.4 32 17.4C40.4 17.4 46.6 27.6 46.6 43.4Z"
            fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          {/* Rib knit. Vertical ribs are what a beanie is, and they also stop a plain blue
              dome reading as a swim cap. */}
          <path d="M23.4 41.8C23 34 24 27.4 26.2 22.4M32 41.8V19.4M40.6 41.8C41 34 40 27.4 37.8 22.4"
            stroke={bodyShade.shineSoft} strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.85" />
          <path
            d="M15 41.4H49C50.4 41.4 51.4 42.5 51.4 43.8V49.6C51.4 51 50.3 52 49 52H15C13.6 52 12.6 51 12.6 49.6V43.8C12.6 42.5 13.6 41.4 15 41.4Z"
            fill={trimFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          <path d="M19.6 44.6V48.8M26.4 44.6V48.8M32 44.6V48.8M37.6 44.6V48.8M44.4 44.6V48.8"
            stroke={trimShade.shineSoft} strokeWidth="1.3" strokeLinecap="round" opacity="0.8" />
          <circle cx="32" cy="12.6" r="6.4" fill={accent} stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M28.6 9.6C29.6 8.4 31 7.8 32.4 7.8" stroke={strokeColor} strokeWidth="1.4" strokeLinecap="round" opacity="0.28" fill="none" />
        </>
      );
    }

    // 平板帽 - the only hat here drawn from the side, because a flat brim seen head-on is
    // a line. Turning it is what lets the brim be a straight, hard-edged slab, which is
    // exactly what the name claims and what separates it from the bucket hat's droop.
    // Draw order matters here and is the fix for a stepped seam: the visor goes down
    // FIRST and is then buried by the dome and the rim, so what shows is a clean slab
    // emerging from under the cap. Drawn last it sat proud of the rim and read as two
    // separate objects.
    return shell(
      <>
        {/* Straight, square-ended and dead level - drawn with a curve it becomes an ordinary
            baseball cap and the product name (帽簷平直不彎曲) stops being true. */}
        <path
          d="M34 41.4H57.8C59.9 41.4 61.2 42.7 61.2 44.3C61.2 46 59.9 47.2 57.8 47.2H34Z"
          fill={trimFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
        />
        <path
          d="M13.4 42.4V29.2C13.4 20.4 20.4 13.6 29.4 13.6C38.4 13.6 45.4 20.4 45.4 29.2V42.4Z"
          fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
        />
        <path
          d="M13 41.2H45.8C46.9 41.2 47.7 42 47.7 43.1V46.9C47.7 48 46.9 48.8 45.8 48.8H13C11.9 48.8 11.1 48 11.1 46.9V43.1C11.1 42 11.9 41.2 13 41.2Z"
          fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
        />
        {/* The snap strap the style is NAMED for, so it gets to be a real part with its own
            snaps rather than a shading line. Drawn over the rim, since it fastens across it. */}
        <path d="M6.6 41.2H14.2V48.8H8.6C7.4 48.8 6.6 47.9 6.6 46.9V43.1C6.6 42 7.4 41.2 8.6 41.2Z"
          fill={accent} stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="10.3" cy="43.6" r="1.2" fill={trimShade.shine} opacity="0.95" />
        <circle cx="10.3" cy="46.4" r="1.2" fill={trimShade.shine} opacity="0.95" />
        {/* Panel seam and the crown button - the structured front panel is the other half of
            what makes a snapback a snapback rather than a soft cap. */}
        <path d="M29.4 16.4V40.8" stroke={bodyShade.shineSoft} strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <circle cx="29.4" cy="14.2" r="2.3" fill={bodyShade.top} stroke={strokeColor} strokeWidth="1.7" />
        <path d="M17.6 30.4C18.4 24 22.4 19.4 28.2 18.2" stroke={bodyShade.shine} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </>
    );
  }

  // Necklaces are drawn ON a jewellery display bust, for the same reason the shoes below are
  // drawn in side profile: the thing that separates these four products is LENGTH, and a length
  // is meaningless without a body to measure it against. The previous icons were four copies of
  // one amber ring differing only in its width and height - a 40cm choker and an 85cm opera rope
  // came out 4px apart in a 56px shop tile, so the grid read as the same product listed four
  // times.
  //
  // Length alone still isn't enough at that size, so each one also gets the two things a
  // jeweller would actually name it by: its own STRAND (a velvet band, a fine cable chain, a
  // beaded strand, a pearl rope) and its own drop. The neckline each item's description
  // recommends is drawn in too - the V-neck, the turtleneck - so the styling advice is in the
  // picture instead of only in the copy underneath it.
  if (currentId.startsWith('neck-')) {
    const isChoker = currentId.includes('choker');
    const isPrincess = currentId.includes('princess');
    const isMatinee = currentId.includes('matinee');

    const GOLD = "#F0B429";
    const GOLD_LIT = "#FFE29A";
    const GOLD_DEEP = "#B87914";

    // Shoulders from the base of the neck down and around to the other side. Every garment
    // below reuses this exact string for its outer edge and then closes with its own neckline,
    // so a collar can never drift a pixel off the shoulder it sits on.
    //
    // The proportion matters more than it looks, and took three passes to land. A neck as wide
    // as 14 against 52 of shoulder makes a BELL, and a necklace on a bell is just a stripe. A
    // narrow neck fixed that but a LONG one is just as bad: run it 23 units down a 64 frame and
    // the silhouette becomes a paddle, with the chain reading as the handle. 9 wide and 16 deep
    // is the pair that reads as a torso, and it hands the remaining two thirds of the frame to
    // the drop - which is the only thing that distinguishes these four products.
    const BUST_SHELL =
      "C27.5 19.8 24 21.4 18 24.6C12.4 27.6 9.6 32.4 9.2 39L9 55H55L54.8 39C54.4 32.4 51.6 27.6 46 24.6C40 21.4 36.5 19.8 36.5 16";

    // A strand hung across the chest, sagging to `drop`. Quadratic, so the control point can be
    // placed at 2*drop - end to put the low point exactly on `drop` rather than wherever a
    // hand-guessed handle happened to land - which is the whole reason these four are
    // distinguishable at 56px. The ends sit just OUTSIDE the neck, on the collarbone, because
    // that is where a chain actually rests.
    const drape = (drop: number) => `M25 19.4Q32 ${2 * drop - 19.4} 39 19.4`;

    // Pearls are spaced along that same curve rather than drawn as a stroke: an opera rope is
    // identifiable BY its beads, and a smooth line would just be a longer version of the
    // princess chain.
    const pearls = (drop: number, r: number, count: number, tag: string) => {
      const nodes = [];
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const u = 1 - t;
        const x = u * u * 25 + 2 * u * t * 32 + t * t * 39;
        const y = u * u * 19.4 + 2 * u * t * (2 * drop - 19.4) + t * t * 19.4;
        nodes.push(
          <g key={`${tag}${i}`}>
            <circle cx={x} cy={y} r={r} fill="#FFFCF2" stroke={strokeColor} strokeWidth="1" />
            <circle cx={x - r * 0.32} cy={y - r * 0.32} r={r * 0.3} fill="#FFFFFF" />
          </g>
        );
      }
      return nodes;
    };

    const neckArt = (() => {
      if (isChoker) {
        // 40cm: the only one of the four that is a BAND and not a chain. It grips the throat,
        // so it is short, wide and dark, and nothing at all hangs past the collarbone - that
        // emptiness below it is the product.
        return (
          <>
            <path d="M19.5 27C23.5 24.8 27 24.2 30.4 24.8M44.5 27C40.5 24.8 37 24.2 33.6 24.8" stroke="#D9C4A6" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M27 11.2C29 15.4 35 15.4 37 11.2" stroke={strokeColor} strokeWidth="7" strokeLinecap="round" fill="none" />
            <path d="M27 11.2C29 15.4 35 15.4 37 11.2" stroke="#1F4F57" strokeWidth="4.6" strokeLinecap="round" fill="none" />
            <path d="M27.1 10C29.1 13.7 34.9 13.7 36.9 10" stroke={GOLD} strokeWidth="0.9" strokeLinecap="round" fill="none" />
            <path d="M27.4 14.2C29.4 17.4 34.6 17.4 36.6 14.2" stroke={GOLD_DEEP} strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.85" />
            <circle cx="32" cy="19.6" r="2.5" fill="none" stroke={GOLD} strokeWidth="1.7" />
            <circle cx="30.9" cy="18.6" r="0.75" fill={GOLD_LIT} />
          </>
        );
      }
      if (isPrincess) {
        // 45-50cm, and the description sells it on V-necks, so it is worn over one. The chain
        // traces the same V a hand's width above the neckline and finishes on a single drop
        // stone - the classic solitaire this length exists to hang.
        return (
          <>
            <path d={`M27.5 16${BUST_SHELL}L32 45Z`} fill="#8FB9CB" stroke="#5C8194" strokeWidth="2" strokeLinejoin="round" />
            <path d="M29.6 20.6L32 43.4L34.4 20.6" stroke="#B3D4E0" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.65" />
            <path d={drape(33)} stroke={strokeColor} strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <path d={drape(33)} stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" fill="none" />
            <path d="M32 32.4C33.9 34.5 35.2 36.4 35.2 38.3C35.2 40.2 33.7 41.7 32 41.7C30.3 41.7 28.8 40.2 28.8 38.3C28.8 36.4 30.1 34.5 32 32.4Z" fill="#5FC6DE" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M31.3 35.6C30.4 36.7 29.9 37.6 29.9 38.5" stroke="#EAFBFF" strokeWidth="1.3" strokeLinecap="round" />
          </>
        );
      }
      if (isMatinee) {
        // 50-60cm over the high collar its description asks for. The strand is beaded rather
        // than smooth and it ends on a flat bar instead of a stone - between the roll neck and
        // the bar this is the tailored, daytime-formal one, which is the whole point of the
        // length.
        return (
          <>
            <path d={`M27.5 16${BUST_SHELL}Z`} fill="#6E7C90" stroke="#4A5568" strokeWidth="2" strokeLinejoin="round" />
            <path d="M26.4 4H37.6V14.6C37.6 17.6 35 19.2 32 19.2C29 19.2 26.4 17.6 26.4 14.6Z" fill="#8494A8" stroke="#4A5568" strokeWidth="2" strokeLinejoin="round" />
            <path d="M26.8 9.4C29.4 11 34.6 11 37.2 9.4" stroke="#5C6A7C" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M27 14.6C29.6 16.4 34.4 16.4 37 14.6" stroke="#5C6A7C" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
            <path d={drape(38)} stroke={strokeColor} strokeWidth="2.8" fill="none" strokeLinecap="round" />
            <path d={drape(38)} stroke={GOLD} strokeWidth="1.5" fill="none" strokeLinecap="round" />
            {[0.18, 0.36, 0.64, 0.82].map((t, i) => {
              const u = 1 - t;
              return (
                <circle
                  key={`st${i}`}
                  cx={u * u * 25 + 2 * u * t * 32 + t * t * 39}
                  cy={u * u * 19.4 + 2 * u * t * (2 * 38 - 19.4) + t * t * 19.4}
                  r="1.5" fill={GOLD_LIT} stroke={strokeColor} strokeWidth="1"
                />
              );
            })}
            <rect x="25.4" y="38.4" width="13.2" height="4.2" rx="2.1" fill={GOLD} stroke={strokeColor} strokeWidth="1.8" />
            <path d="M27.4 40.5H36.6" stroke={GOLD_LIT} strokeWidth="1.1" strokeLinecap="round" />
          </>
        );
      }
      // 70-85cm opera rope. Two strands, because the description offers it both ways: the long
      // one is the full drop below the bust, the short one is the same rope doubled back into a
      // layered short necklace. Drawn on a bare evening neckline - nothing else on the shelf
      // hangs this low, so the icon should let it.
      return (
        <>
          <path d={`M27.5 16${BUST_SHELL}L32 33Z`} fill="#6E2C45" stroke="#4A1B2C" strokeWidth="2" strokeLinejoin="round" />
          <path d="M29.4 19.6L32 31L34.6 19.6" stroke="#93415F" strokeWidth="1.4" fill="none" opacity="0.8" />
          <path d={drape(46)} stroke={strokeColor} strokeWidth="1.4" fill="none" opacity="0.5" />
          <path d={drape(29)} stroke={strokeColor} strokeWidth="1.2" fill="none" opacity="0.5" />
          {pearls(46, 1.8, 13, "po")}
          {pearls(29, 1.45, 11, "pi")}
        </>
      );
    })();

    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <ellipse cx="32" cy="57.4" rx="23" ry="2.2" fill={strokeColor} opacity="0.09" />
        {/* One continuous silhouette, drawn in a MUTED outline rather than the cartoon brown the
            rest of this file uses. The bust is scenery: it exists to give the drop something to
            be measured against, and the moment it carries the same weight of line as the chain,
            the loudest thing in a jewellery icon is the mannequin. Only the necklace gets the
            full-contrast treatment below. */}
        <path d={`M27.5 0V16${BUST_SHELL}V0Z`} fill="#EFE2CE" stroke="#B49A78" strokeWidth="2" strokeLinejoin="round" />
        {/* Round it off - without a shaded side it reads as a flat paper cut-out and the
            necklace looks printed on rather than hung. */}
        <path d="M36.5 16C36.5 19.8 40 21.4 46 24.6C51.6 27.6 54.4 32.4 54.8 39L55 55H48.6L48.4 40C48 34.2 45.6 30 41 27.2C38.6 25.8 37 23 36.5 20Z" fill="#DAC3A2" opacity="0.55" />
        {neckArt}
      </svg>
    );
  }

  // Shoes are drawn as a single shoe in side profile. Front-on they all collapse into the
  // same rounded box and only the fill colour tells them apart, which is not enough - the
  // outline has to say "shoe" before the colour says which shoe. So each item gets its own
  // silhouette (sole thickness, topline height, heel shape, shaft) and the colour and trim
  // are only there to carry the personality on top of a shape that already reads.
  if (currentId.startsWith('shoes-')) {
    const isSport = currentId.includes('sport');
    const isLeather = currentId.includes('leather');
    const isHeels = currentId.includes('heels');
    const isBoots = currentId.includes('boots');
    const isSandals = currentId.includes('sandals');

    // Every shoe stands on the same ground line (y=51.5) so a row of them in the shop grid
    // sits level instead of bobbing about.
    const shoeArt = (() => {
      if (isSport) {
        // Runner: tall heel counter, padded collar, long diagonal vamp, chunky foam midsole.
        return (
          <>
            <path d="M9 42.5C9 40.8 10.2 40 12 40H50C55.4 40 58.6 42.6 58.6 46C58.6 49.4 55 51.5 50 51.5H13.5C10.6 51.5 9 49.8 9 47Z" fill="#F4F7FB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M9.2 46.4C22 48.4 44 48.2 58.4 45C58.5 45.4 58.6 45.7 58.6 46C58.6 49.4 55 51.5 50 51.5H13.5C10.6 51.5 9 49.8 9 47Z" fill="#1F4E7A" />
            <path d="M11 40.4C10.6 32.4 11.2 27.4 13 25C14.5 22.8 17 22 19.4 22.5C22 23 23.6 25 24 28C24.4 30.8 26.2 32.4 29.6 33.2L45.6 37C50 38 51.6 38.8 52 40.4Z" fill="#FFFFFF" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Heel counter and toe cap - the two reinforced panels of a running shoe */}
            <path d="M11 40.4C10.6 32.4 11.2 27.4 13 25C14.5 22.8 17 22 19.4 22.5L16.8 40.4Z" fill="#2E7FD4" />
            <path d="M43.4 36.4L45.6 37C50 38 51.6 38.8 52 40.4H44.6Z" fill="#DCE9F5" />
            {/* Side swoosh sweeping up out of the midsole */}
            <path d="M15.6 38.8C22 39.4 28.6 38 36.4 34L39.4 37C31 41 22.4 41.2 16 40.4Z" fill="#2E7FD4" />
            {/* Tongue standing up in the throat, laces crossing it */}
            <path d="M23.4 28.8C23.8 25.4 25.4 23.4 27.6 23.4C29.6 23.4 30.8 24.8 31 27L31.8 32.8Z" fill="#FFFFFF" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
            <path d="M24.2 27.6L30.4 25.8M24.8 31L31.2 29.2" stroke="#2E7FD4" strokeWidth="2" strokeLinecap="round" />
            {/* Padded collar rim */}
            <path d="M12.8 25.2C14.6 22.8 18.4 22.2 21.4 24.4" stroke="#7CB8EB" strokeWidth="3" strokeLinecap="round" />
            <path d="M46 38.6C48.6 39 50.4 39.6 51.2 40.4" stroke="#FFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
          </>
        );
      }
      if (isLeather) {
        // Oxford: low sleek topline, long tapered toe, stacked heel, brogue punching.
        return (
          <>
            <path d="M12.8 46C12.8 45 13.8 44.4 15.2 44.6L48 47.4C54 48 57.8 49 57.8 50.2C57.8 51.2 54.4 51.7 49 51.7H15.4C13.6 51.7 12.4 50.8 12.4 49.4Z" fill="#C89A64" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M12.8 46C12.8 45 13.8 44.4 15.2 44.6L22.6 45.2V51.7H15.4C13.6 51.7 12.4 50.8 12.4 49.4Z" fill="#8A5A38" />
            <path d="M13.4 45.2C12.8 38.6 13.8 34 16 31.4C18 29.2 20.6 28.4 23 29.2C25.4 30 26.8 32 27.2 34.8C27.6 37.2 29.2 38.6 32.2 39.4L47 43.4C52.4 44.8 54.6 46 55 47.6Z" fill="#4A2C1A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* Toe cap seam with its row of brogue punches */}
            <path d="M43 42.2C45 43.8 46 45.4 46.2 47.2" stroke="#8A5A38" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="44" cy="43.6" r="0.7" fill="#C89A64" />
            <circle cx="45.2" cy="45" r="0.7" fill="#C89A64" />
            <circle cx="45.9" cy="46.4" r="0.7" fill="#C89A64" />
            {/* Lace facing across the throat */}
            <path d="M27 34.4C28.6 37 31 38.6 33.8 39.6" stroke="#2E1A0F" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
            <path d="M27.3 38.5L30.7 34.7M29.3 40.1L32.7 36.3" stroke="#D9B98C" strokeWidth="1.8" strokeLinecap="round" />
            {/* Polish */}
            <path d="M46.6 43.6C50 44.6 53 45.8 54.4 47" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.3" />
            <path d="M17.4 34.6C19.8 32.4 22.4 32.4 24.4 34.4" stroke="#FFF" strokeWidth="2.6" strokeLinecap="round" opacity="0.22" />
          </>
        );
      }
      if (isHeels) {
        // Pump: pointed toe on the floor, high arch, deep throat, slim stiletto at the back.
        return (
          <>
            {/* Upper, sole and stiletto are a single closed outline, and everything layered on
                top of it is fill-only. Split into stacked stroked shapes, the forefoot ends up
                carrying four 2.5 outlines inside about six units of height and goes solid dark -
                and any shape that does not quite meet the next one leaves a crack. */}
            <path d="M58 50.4C54 46.6 50.4 44.2 45.6 43.4L32.4 41C29.2 39.8 27.4 37.6 27 34.8C26.4 31 25.4 27.8 23.4 26.4C21.4 25 19.4 26.2 19 29C18.6 31.8 18.8 35.4 19.2 38.6C18.8 42.4 19.6 47 21.4 51.4H25.6L24.6 47.4C26.8 49.4 29.6 50.8 33 51.4C41.4 52.6 51 52.2 58 50.4Z" fill="#E11D64" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M19.2 38.6C18.8 42.4 19.6 47 21.4 51.4H25.6L24.6 47.4C22.4 45.4 20.4 42.4 19.2 38.6Z" fill="#C4134F" />
            <path d="M21.5 48.8H25.2L25.6 51.4H21.4Z" fill="#7A0C36" />
            {/* Satin sheen following the vamp */}
            <path d="M28 38C32 41 38 43.6 45 45" stroke="#FFF" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
            <path d="M21.4 28.6C22.4 30.4 23.2 32.6 23.8 35.2" stroke="#FFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
            {/* Gem at the throat */}
            <circle cx="35" cy="45" r="2.6" fill="#FFD84D" stroke={strokeColor} strokeWidth="1.6" />
            <circle cx="34.2" cy="44.2" r="0.8" fill="#FFF" />
            <path d="M21 28.6C22 30.2 22.8 32.2 23.4 34.6" stroke="#FFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
          </>
        );
      }
      if (isBoots) {
        // Tall boot: the shaft is the whole point, so it gets the height, the folded cuff
        // and the buckled ankle strap, standing on a flat lug sole.
        return (
          <>
            <path d="M15 18C15 15.6 16.8 14 19.4 14H29.6C32.2 14 34 15.6 34 18V36.4C38.6 37.8 45.4 39.4 50.4 40.6C54.6 41.6 56.4 42.6 56.4 44.6H17C15.8 44.6 15 43.8 15 42.6Z" fill="#3F4550" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M46 39.6C51 40.8 54.6 41.8 56.2 44.6H46.6Z" fill="#4C525E" />
            <path d="M18.6 24C18.2 31 18.2 38 18.8 43" stroke="#FFF" strokeWidth="4.5" strokeLinecap="round" opacity="0.13" />
            {/* Sole: tan welt over a dark lug tread */}
            <path d="M12.4 45C12.4 44 13.4 43.4 15 43.4H50.4C55.6 43.4 58.6 45 58.6 47.4C58.6 49 57.2 50 55 50H15.4C13.4 50 12.4 49 12.4 47.2Z" fill="#D9A566" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M13 48C13 47.2 13.8 46.8 15 46.8H55.4C57 46.8 58.2 47.8 58.2 49.4C58.2 51 57 51.9 55.4 51.9H14.6C13 51.9 12 51 12 49.6Z" fill="#2A2E36" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
            <path d="M22 47.4V51.4M30 47.4V51.4M38 47.4V51.4M46 47.4V51.4" stroke="#4C525E" strokeWidth="1.6" strokeLinecap="round" />
            {/* Ankle strap and buckle */}
            <path d="M13.8 29.4H35.2C36 29.4 36.6 30 36.6 30.8V34C36.6 34.8 36 35.4 35.2 35.4H13.8C13 35.4 12.4 34.8 12.4 34V30.8C12.4 30 13 29.4 13.8 29.4Z" fill="#2A2E36" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
            <rect x="29.2" y="28.4" width="7" height="8.4" rx="2" fill="#FFC94D" stroke={strokeColor} strokeWidth="1.8" />
            <path d="M32.7 30.4V34.8" stroke={strokeColor} strokeWidth="1.4" strokeLinecap="round" />
            {/* Folded-over cuff, wider than the shaft */}
            <path d="M12.6 15C12.6 13 14.2 11.6 16.6 11.6H32.4C34.8 11.6 36.4 13 36.4 15V19.6C36.4 21.6 34.8 23 32.4 23H16.6C14.2 23 12.6 21.6 12.6 19.6Z" fill="#A97C50" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M15 17.4H34" stroke="#8A5A32" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
          </>
        );
      }
      if (isSandals) {
        // Slide: an open shape is what says "sandal", so the straps are drawn first and the
        // cork footbed lands on top to tuck their ends in.
        return (
          <>
            {/* Every strap ends either under the sole or exactly on the medallion - a strap
                that stops in mid-air is the thing that makes the icon look broken. */}
            {/* The heel strap lands partway down the instep strap, not on its apex. Run all the
                way up it encloses a solid triangle and the sandal reads as a tent. */}
            <path d="M20 46L32 30.4L43.5 45M14.8 45.5C13.2 40 15 34.6 19.6 32.2C22.8 30.6 26.4 31.8 29 34.3" stroke={strokeColor} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14.8 45.5C13.2 40 15 34.6 19.6 32.2C22.8 30.6 26.4 31.8 29 34.3" stroke="#FF9E7A" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M20 46L32 30.4L43.5 45" stroke="#FF7A59" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {/* Two-layer sole: rubber outsole under a cork footbed */}
            <path d="M11.6 47C11.6 46 12.8 45.4 14.8 45.4H50C55 45.4 58.2 46.8 58.2 48.8C58.2 50.6 55 51.6 50 51.6H14.8C12.6 51.6 11.6 50.4 11.6 48.8Z" fill="#A9743E" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M11 44.4C11 42.8 12.4 42 14.6 42H50C55.2 42 58.6 43.4 58.6 45.4C58.6 47.4 55.2 48.6 50 48.6H14.6C12.4 48.6 11 47.6 11 46Z" fill="#EFD3A4" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M15.4 44.4C25 45.2 45 45 55 44" stroke="#D4B075" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="19" cy="43.6" r="0.9" fill="#C99A5E" opacity="0.7" />
            <circle cx="29" cy="44.2" r="0.7" fill="#C99A5E" opacity="0.7" />
            <circle cx="40" cy="43.4" r="0.9" fill="#C99A5E" opacity="0.7" />
            <circle cx="50" cy="44" r="0.7" fill="#C99A5E" opacity="0.7" />
            {/* Medallion where the straps cross */}
            <circle cx="32" cy="30" r="4.2" fill="#FFC94D" stroke={strokeColor} strokeWidth="2" />
            <path d="M32 27.2L33.1 29.5L35.4 30.6L33.1 31.7L32 34L30.9 31.7L28.6 30.6L30.9 29.5Z" fill="#FFF4D2" />
          </>
        );
      }
      // Flip-flop (id is still shoes-flats, see constants/items.ts), and the fallback for any
      // shoes-* id added later. The Y strap is deliberately lopsided - a short steep toe post
      // at the front against one long shallow run to the back anchor. The sandal above is also
      // a strap over a sole, and that asymmetry is what stops the two reading as the same shoe.
      return (
        <>
          {/* Toe post and back strap are one polyline and both ends finish below the top of
              the footbed, so the sole covers the joins instead of leaving them showing. */}
          <path d="M50 44.5L41 31.5L24 44.5" stroke={strokeColor} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M50 44.5L41 31.5L24 44.5" stroke="#17B8B0" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="41" cy="31.5" r="2.4" fill="#8AE6DF" stroke={strokeColor} strokeWidth="1.8" />
          {/* Thin foam sole - the sandal's chunky cork stack is the other half of telling
              these two apart in the grid. */}
          <path d="M11 45C11 43.6 12.4 42.8 14.4 42.8H50C55.2 42.8 58.6 44.2 58.6 46.2C58.6 48 55.2 49 50 49H14.4C12.2 49 11 48 11 46.4Z" fill="#FFFDF5" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M11.6 47.4C11.6 46.6 12.8 46 14.8 46H50C55 46 58.2 47 58.2 48.6C58.2 50.2 55 51 50 51H14.8C12.6 51 11.6 50 11.6 48.6Z" fill="#17B8B0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M15.4 45C25 45.8 44 45.6 54.4 44.6" stroke="#D9EFE9" strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    })();

    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <ellipse cx="34" cy="55.6" rx="23" ry="2.8" fill={strokeColor} opacity="0.12" />
        {shoeArt}
      </svg>
    );
  }

  // Every `pants-*` id resolves to a cut in TROUSER_CUTS (see the write-up above it). The id
  // suffix IS the key, so adding a trouser to constants/items.ts means adding its half-widths and
  // palette there — not another branch here.
  if (currentId.startsWith('pants-')) {
    return (
      <TrouserIcon
        cut={currentId.slice('pants-'.length)}
        size={size}
        className={className}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  // 熱帶草裙 is 下裝 as well, and is drawn on the trousers' stations (see GRASS SKIRT above), so it
  // resolves here beside them rather than in the legacy id ladder further down.
  if (currentId === 'item-0') {
    return <GrassSkirtIcon size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  if (currentId === 'top-jacket') {
    return <JacketIcon size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  // Special cosmetics resolve from their catalog row (constants/cosmeticEffects.ts) rather
  // than getting a hand-drawn case each — same arrangement as trousers above and House
  // Styles below, and the reason a new ornament cannot fall through to the grey placeholder.
  if (isSpecialCosmeticIcon(currentId)) {
    return <SpecialCosmeticIcon itemId={currentId} size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  // 藝術品, same arrangement and for the same reason: the icon is generated from the catalog row
  // that generates the 3D piece (constants/artwork.ts), so a new artwork's card is drawn the day
  // it is added and can never show a different object from the one that gets placed in the room.
  if (isArtworkIcon(currentId)) {
    return <ArtworkIcon itemId={currentId} size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  // NPC —— 島上兩位居民各一張半身像，顏色跟 3D 那兩隻同一組（constants/npcs.ts）。
  // 還留著 UnknownIcon 的出口：將來多一位居民、圖示還沒畫好的那段日子，他拿到的是明講的
  // 問號（「這裡的樣子還沒定」），而不是最下面那個會被讀成壞掉的灰盒子。
  if (currentId === 'npc-hippo-butler') {
    return <HippoButlerIcon size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }
  if (currentId === 'npc-cookie-rabbit') {
    return <CookieRabbitIcon size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }
  if (currentId.startsWith('npc-')) {
    return <UnknownIcon size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  // 特殊卡牌 —— 抽獎券。認的是「這件商品發的是券」（constants/items.ts 的 grantsTickets）而不是
  // 一個寫死的 id，所以之後多一種「五張裝」只要在目錄裡多一行，這裡不用動。
  if (getItemById(currentId)?.grantsTickets) {
    return <RaffleTicketIcon size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  // Every `pet-*` id resolves to a breed in PET_SPECS — the id suffix IS the key, so adding a
  // breed to constants/items.ts means adding its palette and marks there, not a branch here.
  const petSpecies = PET_ICONS.find(s => currentId.startsWith(`pet-${s.id}-`));
  if (petSpecies) {
    const Icon = petSpecies.Icon;
    return (
      <Icon
        breed={currentId.slice(`pet-${petSpecies.id}-`.length)}
        size={size}
        className={className}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  // House Styles are drawn from their own palette + roof shape rather than getting a
  // hand-authored case each, so adding an appearance to constants/houseStyles.ts gives it a
  // correct shop icon with no edit here. Checked before the id switch below, which is an
  // exact-match ladder that would otherwise fall through to the grey placeholder.
  const houseStyle = getHouseStyleByItemId(currentId);
  if (houseStyle) {
    return <HouseStyleIcon style={houseStyle} size={size} className={className} strokeColor={strokeColor} strokeWidth={strokeWidth} />;
  }

  // Render Item Icons (Second Layer: items list inside categories)
  // Let's design gorgeous Q-version items by matching item.id!
  switch (currentId) {
    // ---- FLOOR SWATCHES (Durable glossy, wood, pattern textures) ----
    case 'item-1': // Island Shirt (海島襯衫)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex flex-col items-center justify-center pt-4 scale-110">
          <div className="relative group">
            <div className="w-26 h-30 bg-sky-100 rounded-t-xl rounded-b-lg border-[4px] border-sky-300 shadow-2xl relative overflow-hidden">
               <div className="absolute inset-0 opacity-20 pointer-events-none grid grid-cols-3 gap-4 p-4">
                  {[...Array(6)].map((_, i) => <Palmtree key={i} size={16} className="text-sky-900" />)}
               </div>
               <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-6 border-b-2 border-x-2 border-sky-300 rounded-b-full bg-sky-50 shadow-inner" />
               <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col gap-3">
                  {[1,2,3,4].map(i => <div key={i} className="w-2 h-2 bg-white border border-sky-300 rounded-full shadow-sm" />)}
               </div>
               <div className="absolute top-10 left-3 w-8 h-8 bg-sky-50 border border-sky-200 rounded-sm shadow-sm" />
            </div>
            <div className="absolute top-2 -left-6 w-10 h-16 bg-sky-100 border-[3.5px] border-sky-300 rounded-lg -rotate-12" />
            <div className="absolute top-2 -right-6 w-10 h-16 bg-sky-100 border-[3.5px] border-sky-300 rounded-lg rotate-12" />
          </div>
          <div className="absolute bottom-1 text-[10px] font-black text-sky-500 tracking-widest uppercase bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">Breezy Linen</div>
        </div>,
        160
      );

    case 'item-2': // Surf Wetsuit
    case 'item-27': // Dive suit
      {
        const isSurf = currentId === 'item-2';
        return wrapLegacyIcon(
          <div className="relative w-40 h-40 flex flex-col items-center justify-center pt-6 scale-110">
            <div className="relative group">
              <div className={`w-20 h-30 ${isSurf ? 'bg-zinc-800' : 'bg-zinc-900'} rounded-t-[2.5rem] rounded-b-xl border-[4px] border-zinc-950 relative shadow-2xl overflow-hidden`}>
                 <div className="absolute top-0 left-0 w-full h-full bg-linear-to-b from-white/5 to-transparent" />
                 <div className={`absolute top-4 left-0 w-4 h-24 ${isSurf ? 'bg-orange-500' : 'bg-emerald-500'} rounded-r-xl border-r border-white/20`} />
                 <div className={`absolute top-4 right-0 w-4 h-24 ${isSurf ? 'bg-orange-500' : 'bg-emerald-500'} rounded-l-xl border-l border-white/20`} />
                 <div className="absolute top-10 left-1/2 -translate-x-1/2 opacity-40">
                    <Waves size={20} className="text-white" />
                 </div>
                 <div className="absolute top-16 left-1/2 -translate-x-1/2 w-1 h-14 bg-zinc-700 flex flex-col items-center gap-1 py-1">
                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-sm" />
                 </div>
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.05),transparent)]" />
              </div>
              <div className={`absolute top-4 -left-4 w-10 h-14 ${isSurf ? 'bg-zinc-800' : 'bg-zinc-900'} border-2 border-zinc-950 rounded-lg -rotate-15`} />
              <div className={`absolute top-4 -right-4 w-10 h-14 ${isSurf ? 'bg-zinc-800' : 'bg-zinc-900'} border-2 border-zinc-950 rounded-lg rotate-15`} />
            </div>
            <div className={`absolute bottom-2 text-[10px] font-black ${isSurf ? 'text-orange-400 border-orange-500/30' : 'text-emerald-400 border-emerald-500/30'} tracking-widest uppercase bg-black/40 px-2 py-0.5 rounded-full border backdrop-blur-sm`}>
              {isSurf ? 'High-Performance' : 'Pro Neoprene'}
            </div>
          </div>,
          160
        );
      }

    case 'item-3': // Beach Swimsuit (沙灘泳衣)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex flex-col items-center justify-center pt-6 scale-110">
          <div className="relative group">
             <div className="w-18 h-28 bg-rose-500 rounded-t-[3rem] rounded-b-2xl border-[4px] border-rose-900 shadow-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_8px,rgba(255,255,255,0.1)_10px)]" />
                <div className="absolute top-0 left-0 w-full h-full bg-linear-to-br from-white/20 via-transparent to-black/10" />
                <div className="absolute top-1/2 left-0 w-full h-4 bg-rose-600/50 -translate-y-1/2 border-y border-rose-400/30" />
                <div className="absolute top-4 left-1/2 -translate-x-1/2 text-rose-200 opacity-60">
                   <Flower2 size={16} />
                </div>
             </div>
             <div className="absolute -top-1 left-2 w-4 h-8 border-l-[3px] border-rose-900 rounded-tl-full" />
             <div className="absolute -top-1 right-2 w-4 h-8 border-r-[3px] border-rose-900 rounded-tr-full" />
          </div>
          <div className="absolute bottom-2 text-[10px] font-black text-rose-400 tracking-widest uppercase bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">Elegance Swim</div>
        </div>,
        160
      );

    case 'item-4': // Explorer Outfit (探險套裝)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex flex-col items-center justify-center pt-4 scale-110">
           <div className="relative">
              <div className="w-26 h-30 bg-amber-100 rounded-t-xl rounded-b-lg border-[4px] border-amber-800 shadow-2xl relative overflow-hidden">
                 <div className="absolute inset-0 bg-linear-to-br from-white/10 via-transparent to-black/10" />
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-8 bg-amber-50 border-b-[4px] border-amber-800 rounded-b-full shadow-inner" />
                 <div className="absolute bottom-8 left-0 w-full h-4 bg-amber-800 flex items-center justify-center">
                    <div className="w-4 h-4 bg-yellow-400 border border-amber-900 rounded-sm" />
                 </div>
                 <div className="absolute top-10 left-2 w-8 h-8 bg-amber-50 border-2 border-amber-800 rounded-md shadow" />
                 <div className="absolute top-10 right-2 w-8 h-8 bg-amber-50 border-2 border-amber-800 rounded-md shadow" />
              </div>
              <div className="absolute top-2 -left-6 w-10 h-16 bg-amber-100 border-[3.5px] border-amber-800 rounded-lg -rotate-12" />
              <div className="absolute top-2 -right-6 w-10 h-16 bg-amber-100 border-[3.5px] border-amber-800 rounded-lg rotate-12" />
           </div>
           <div className="absolute bottom-1 text-[10px] font-black text-amber-700 tracking-widest uppercase bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Wild Canvas</div>
        </div>,
        160
      );

    // 草帽 is handled by the hat branch above, alongside the other four hats, so that
    // all five are drawn from HAT_PALETTES rather than one of them inventing its own
    // amber. Its old case lived here and rendered a pale `bg-amber-100` brim with a
    // black band, against a 3D model that is #d97706 with a red one.

    case 'item-26': // Captain's Uniform (船長制服)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex flex-col items-center justify-center pt-4 scale-110">
           <div className="relative">
              <div className="w-28 h-32 bg-slate-900 rounded-t-2xl rounded-b-lg border-[4px] border-black shadow-2xl relative overflow-hidden">
                 <div className="absolute inset-0 bg-linear-to-br from-white/5 via-transparent to-black/20" />
                 <div className="absolute top-12 left-4 flex flex-col gap-3">
                    {[1,2,3].map(i => <div key={i} className="w-2.5 h-2.5 bg-amber-400 border border-amber-600 rounded-full shadow-[0_0_5px_rgba(251,191,36,0.5)]" />)}
                 </div>
                 <div className="absolute top-12 right-4 flex flex-col gap-3">
                    {[1,2,3].map(i => <div key={i} className="w-2.5 h-2.5 bg-amber-400 border border-amber-600 rounded-full shadow-[0_0_5px_rgba(251,191,36,0.5)]" />)}
                 </div>
                 <div className="absolute top-0 left-0 w-10 h-3 bg-amber-500 border-b-2 border-amber-700" />
                 <div className="absolute top-0 right-0 w-10 h-3 bg-amber-500 border-b-2 border-amber-700" />
                 <div className="absolute bottom-4 left-0 w-full h-4 flex flex-col gap-1">
                    <div className="h-1 bg-amber-500" />
                    <div className="h-1 bg-amber-500" />
                 </div>
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-black/40" />
              </div>
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-16 h-8 bg-slate-900 border-[3.5px] border-black rounded-[2rem] z-20 flex items-center justify-center">
                 <Anchor size={14} className="text-amber-500" />
              </div>
           </div>
           <div className="absolute bottom-2 text-[10px] font-black text-amber-500 tracking-widest uppercase bg-black/60 px-3 py-1 rounded-full border border-amber-600/30 backdrop-blur-md">Command Rank</div>
        </div>,
        160
      );

    case 'item-32': // Adventure Vest (探險背心)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex flex-col items-center justify-center pt-4 scale-110">
           <div className="relative">
              <div className="w-24 h-28 bg-stone-500 rounded-t-xl rounded-b-lg border-[4px] border-stone-800 shadow-2xl relative overflow-hidden">
                 <div className="absolute inset-0 bg-linear-to-br from-white/10 via-transparent to-black/10" />
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-8 bg-[#f8f9f2] border-b-[4px] border-stone-800 rounded-b-full shadow-inner" />
                 <div className="absolute top-10 left-2 w-8 h-8 bg-stone-600 border-2 border-stone-800 rounded-md shadow-lg" />
                 <div className="absolute top-10 right-2 w-8 h-8 bg-stone-600 border-2 border-stone-800 rounded-md shadow-lg" />
                 <div className="absolute bottom-4 left-2 w-18 h-10 bg-stone-600 border-2 border-stone-800 rounded-md shadow-lg flex gap-1 px-1 py-1">
                    <div className="flex-1 border-r border-stone-800/30" />
                    <div className="flex-1" />
                 </div>
              </div>
           </div>
           <div className="absolute bottom-2 text-[10px] font-black text-stone-300 tracking-widest uppercase bg-black/40 px-2 py-0.5 rounded-full border border-stone-700 backdrop-blur-sm">Tactical</div>
        </div>,
        160
      );

    case 'item-33': // Island Shawl (島嶼披肩)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex items-center justify-center pt-4 scale-110">
          <motion.div 
            animate={{ rotate: [-2, 2, -2] }}
            transition={{ duration: 5, repeat: Infinity }}
            className="w-32 h-24 bg-rose-400 rounded-[3rem] border-[4px] border-rose-900 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center"
          >
             <div className="absolute inset-0 bg-[radial-gradient(circle_rgba(255,165,0,0.4),transparent_60%)]" />
             <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.15)_12px)]" />
             <div className="flex gap-4 opacity-40">
                <Flower2 size={24} className="text-white" />
                <Flower2 size={24} className="text-white" />
             </div>
             <div className="absolute top-0 w-full h-8 bg-linear-to-b from-white/20 to-transparent" />
          </motion.div>
          <div className="absolute bottom-4 text-[10px] font-black text-rose-100 tracking-widest uppercase bg-rose-900/40 px-2 py-0.5 rounded-full border border-rose-500/30 backdrop-blur-sm">Boho Silk</div>
        </div>,
        160
      );

    case 'acc-glasses': // Retro Sunglasses (復古墨鏡)
      return wrapLegacyIcon(
        <div className="relative w-40 h-40 flex flex-col items-center justify-center scale-115">
          <motion.div 
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 flex items-center justify-center"
          >
             <div className="w-14 h-10 bg-zinc-900 rounded-b-2xl rounded-t-sm border-[3px] border-yellow-500 relative shadow-lg overflow-hidden flex items-center justify-center">
                <div className="absolute top-1 left-2 w-8 h-2 bg-white/20 rotate-12 blur-[0.5px]" />
                <div className="absolute inset-1 border border-white/5 rounded-b-xl" />
             </div>
             <div className="w-4 h-2 bg-yellow-500 border border-yellow-600 -mx-0.5 relative z-20 shadow shadow-black/40" />
             <div className="w-14 h-10 bg-zinc-950 rounded-b-2xl rounded-t-sm border-[3px] border-yellow-500 relative shadow-lg overflow-hidden flex items-center justify-center">
                <div className="absolute top-1 left-2 w-8 h-2 bg-white/20 rotate-12 blur-[0.5px]" />
                <div className="absolute inset-1 border border-white/5 rounded-b-xl" />
             </div>
          </motion.div>
          <div className="absolute bottom-2 text-[10px] font-black text-yellow-600 tracking-widest uppercase bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-200">Classic Aviator</div>
        </div>,
        160
      );

    // Tribal Mask (部落面具). Redrawn to match the piece as it actually looks worn: the 3D mesh
    // in Avatar.tsx is dark carved wood (#78350F) with a single gold band across the brow
    // (#FCD34D), and those two colours are reused verbatim here so the shop tile and the avatar
    // are recognisably the same object.
    //
    // What the old icon was missing wasn't detail, it was DEPTH. It stacked flat rounded boxes -
    // a red bar for a mouth, two yellow discs for eyes - so it read as a printed sticker, while
    // the thing on the character's face reads as a carved object catching the light. Everything
    // below is built to put that back: the features are cut INTO the face (each one has its own
    // shadow above and its own lit edge below), the rim is bevelled light on one side and dark
    // on the other, and the grain runs the length of the timber. The mask is also given the
    // taller-than-wide shield proportion of the mesh (0.286 x 0.347) instead of the old
    // rounded-rectangle, since the silhouette is what has to say "mask" before any colour does.
    case 'acc-mask':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="32" cy="60" rx="14" ry="2.2" fill={strokeColor} opacity="0.12" />

          {/* Carved timber blank */}
          <path d="M32 5.5C22.2 5.5 15.4 10.2 15.4 18C15.4 26.2 16.4 33.4 18.5 40.6C20.6 47.8 25.2 56.4 32 58.6C38.8 56.4 43.4 47.8 45.5 40.6C47.6 33.4 48.6 26.2 48.6 18C48.6 10.2 41.8 5.5 32 5.5Z" fill="#78350F" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Bevel: lit on the left, in shadow on the right. A single pair of shapes does more
              for "this is a solid object" than any amount of surface pattern. */}
          <path d="M32 5.5C22.2 5.5 15.4 10.2 15.4 18C15.4 26.2 16.4 33.4 18.5 40.6C20.6 47.8 25.2 56.4 32 58.6C28.4 53.4 25 46.4 23.2 39.4C21.4 32.4 20.8 24.6 21.4 17.6C21.9 11.4 25.6 7.4 32 5.5Z" fill="#FFFFFF" opacity="0.1" />
          <path d="M32 5.5C41.8 5.5 48.6 10.2 48.6 18C48.6 26.2 47.6 33.4 45.5 40.6C43.4 47.8 38.8 56.4 32 58.6C35.6 53.4 39 46.4 40.8 39.4C42.6 32.4 43.2 24.6 42.6 17.6C42.1 11.4 38.4 7.4 32 5.5Z" fill="#2A1206" opacity="0.28" />
          {/* Grain running the length of the plank */}
          <path d="M26.4 20.5C25.2 30 25.6 42 28.4 53.6M37.6 20.5C38.8 30 38.4 42 35.6 53.6" stroke="#2A1206" strokeWidth="1" strokeLinecap="round" opacity="0.22" />

          {/* Gold brow band - the one ornament the worn mesh actually has */}
          <path d="M15.5 19.6C15.4 11 22.2 5.5 32 5.5C41.8 5.5 48.6 11 48.5 19.6C41.2 16.4 22.8 16.4 15.5 19.6Z" fill="#FCD34D" stroke={strokeColor} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M18.6 12.4C24 9.6 40 9.6 45.4 12.4" stroke="#FFF3C4" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
          <path d="M17 17.6C24 15.2 40 15.2 47 17.6" stroke="#B7860B" strokeWidth="1.3" strokeLinecap="round" />
          {/* Punched dots along the band, the way beaten metal trim is decorated */}
          <circle cx="24" cy="13.6" r="1.05" fill="#B7860B" />
          <circle cx="32" cy="12.6" r="1.05" fill="#B7860B" />
          <circle cx="40" cy="13.6" r="1.05" fill="#B7860B" />

          {/* Eye slits, cut on a downward slant so the mask has an expression rather than a
              stare. The dark arc above each one is the overhang the cut leaves behind. */}
          <path d="M20.4 27.4C22.4 23.9 27.4 23.6 30.2 26.9C27.6 30.4 22.4 30.6 20.4 27.4Z" fill="#F7E6C2" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M43.6 27.4C41.6 23.9 36.6 23.6 33.8 26.9C36.4 30.4 41.6 30.6 43.6 27.4Z" fill="#F7E6C2" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M21 26.2C23.2 23.6 27.6 23.6 30 26" stroke="#2A1206" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
          <path d="M43 26.2C40.8 23.6 36.4 23.6 34 26" stroke="#2A1206" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
          <circle cx="25.6" cy="27" r="1.85" fill="#2A1206" />
          <circle cx="38.4" cy="27" r="1.85" fill="#2A1206" />

          {/* Nose ridge, standing proud of the face - lit down its left edge, shadowed on the
              right, same light as the rim bevel. */}
          <path d="M29.6 26.4H34.4L35.2 39.4C35.2 41.1 33.8 42.1 32 42.1C30.2 42.1 28.8 41.1 28.8 39.4Z" fill="#8F4A16" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M30.4 27.6L29.9 39.2" stroke="#C07C3A" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M33.8 27.6L34.3 39.4" stroke="#2A1206" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />

          {/* Ochre war paint - three strokes a side, tapering downward */}
          <path d="M20.6 33.4L24.8 35.6L20.6 37.8" stroke="#C2410C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M21.4 40L24.9 41.8L21.6 43.6" stroke="#C2410C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M43.4 33.4L39.2 35.6L43.4 37.8" stroke="#C2410C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M42.6 40L39.1 41.8L42.4 43.6" stroke="#C2410C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />

          {/* Mouth cut clean through the timber, teeth showing behind it */}
          <path d="M23.6 45.2H40.4C41.5 45.2 42.2 46 42 47.1L41.2 50.8C41 51.9 40.1 52.6 39 52.6H25C23.9 52.6 23 51.9 22.8 50.8L22 47.1C21.8 46 22.5 45.2 23.6 45.2Z" fill="#2A1206" stroke={strokeColor} strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M25.2 46.6H26.9V49.4H25.4ZM28.9 46.6H30.7V49.8H29.2ZM33.3 46.6H35.1V49.8H33.6ZM37.1 46.6H38.8V49.4H37.4Z" fill="#F7E6C2" />
          <path d="M23.4 46.4H40.6" stroke="#000000" strokeWidth="1.2" opacity="0.45" strokeLinecap="round" />
        </svg>
      );

    // ---- FLOOR SWATCHES (Durable glossy, wood, pattern textures) ----
    case 'floor-oak':
      return (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Detailed Q-version preview of beautiful light wood floor tiles */}
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <rect x="4" y="4" width="56" height="56" rx="12" fill="#C68E5A" stroke={strokeColor} strokeWidth="3" />
            {/* Wooden Planks */}
            <line x1="4" y1="20" x2="60" y2="20" stroke={strokeColor} strokeWidth="2.5" />
            <line x1="4" y1="40" x2="60" y2="40" stroke={strokeColor} strokeWidth="2.5" />
            <line x1="22" y1="4" x2="22" y2="20" stroke={strokeColor} strokeWidth="2.5" />
            <line x1="42" y1="20" x2="42" y2="40" stroke={strokeColor} strokeWidth="2.5" />
            <line x1="18" y1="40" x2="18" y2="60" stroke={strokeColor} strokeWidth="2.5" />
            {/* Wood grains */}
            <path d="M8 12C12 12 16 10 18 12M32 30C36 30 38 32 42 30" stroke="#8A5A2B" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            {/* Cute shine gloss reflection */}
            <path d="M8 8L52 52" stroke="#FFF" strokeWidth="4" strokeLinecap="round" opacity="0.2" />
          </svg>
        </div>
      );
    case 'floor-white-tile':
      return (
        <div className="relative w-full h-full flex items-center justify-center">
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            {/* No grid. The 3D floor is a single seamless white sheet (see
                Three/floorMaterial.ts), and the icon has to promise the same
                thing - a grout cross here would sell a tiled floor the player
                does not actually get. The shine is the whole subject instead. */}
            <rect x="4" y="4" width="56" height="56" rx="12" fill="#FCFEFF" stroke={strokeColor} strokeWidth="3" />
            {/* Broad soft reflection sweeping across the polished surface */}
            <path d="M8 44C20 40 30 24 40 8" stroke="#E8F4FA" strokeWidth="14" strokeLinecap="round" opacity="0.9" />
            <path d="M14 54C26 48 40 32 56 22" stroke="#F2FAFD" strokeWidth="9" strokeLinecap="round" opacity="0.8" />
            {/* Sparkles on the glaze */}
            <path d="M14 16L18 20M18 16L14 20" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
            <path d="M46 46L50 50M50 46L46 50" stroke="#7DD3FC" strokeWidth="2" strokeLinecap="round" />
            {/* Crisp highlight streak */}
            <path d="M14 8L52 46" stroke="#FFF" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
          </svg>
        </div>
      );
    case 'floor-industrial-concrete':
      return (
        <div className="relative w-full h-full flex items-center justify-center">
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            {/* Dark seamless pour, matching the 3D material. No joints, no grid -
                an uninterrupted surface is the entire point of the style. */}
            <rect x="4" y="4" width="56" height="56" rx="12" fill="#23272E" stroke={strokeColor} strokeWidth="3" />
            {/* Burnished trowel sweeps - the lighter, glossier passes */}
            <path d="M8 40C20 34 30 22 42 10" stroke="#3B424C" strokeWidth="16" strokeLinecap="round" opacity="0.85" />
            <path d="M18 56C30 50 44 36 58 30" stroke="#333944" strokeWidth="11" strokeLinecap="round" opacity="0.7" />
            {/* Ground aggregate showing through the polish */}
            <circle cx="17" cy="21" r="1.4" fill="#8A94A2" opacity="0.75" />
            <circle cx="45" cy="17" r="1" fill="#79838f" opacity="0.7" />
            <circle cx="31" cy="43" r="1.7" fill="#98A2AE" opacity="0.6" />
            <circle cx="21" cy="49" r="1.1" fill="#6D7684" opacity="0.75" />
            <circle cx="47" cy="38" r="1.3" fill="#828C99" opacity="0.65" />
            <circle cx="38" cy="27" r="0.9" fill="#5E6672" opacity="0.8" />
            {/* Low sheen off the sealed surface */}
            <path d="M12 12C26 8 44 18 56 30" stroke="#FFF" strokeWidth="3" strokeLinecap="round" opacity="0.10" />
          </svg>
        </div>
      );
    case 'floor-vintage-pattern':
      return (
        <div className="relative w-full h-full flex items-center justify-center">
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <rect x="4" y="4" width="56" height="56" rx="12" fill="#FAF5E6" stroke={strokeColor} strokeWidth="3" />
            {/* Vintage French tile cross pattern */}
            <circle cx="32" cy="32" r="14" fill="#3B82F6" stroke={strokeColor} strokeWidth="2.5" />
            {/* Inner Star */}
            <path d="M32 18L36 28L46 32L36 36L32 46L28 36L18 32L28 28Z" fill="#F59E0B" stroke={strokeColor} strokeWidth="2" />
            <circle cx="32" cy="32" r="3" fill="#FFF" />
            {/* Corner decorations */}
            <path d="M4 16C8 16 16 8 16 4" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            <path d="M60 16C56 16 48 8 48 4" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            <path d="M4 48C8 48 16 56 16 60" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
            <path d="M60 48C56 48 48 56 48 60" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'floor-luxury-marble':
      return (
        <div className="relative w-full h-full flex items-center justify-center">
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <rect x="4" y="4" width="56" height="56" rx="12" fill="#E2E8F0" stroke={strokeColor} strokeWidth="3" />
            {/* Marble veins */}
            <path d="M8 52C20 48 32 50 44 32C48 26 52 14 56 8" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
            <path d="M12 12C24 16 30 28 34 38" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            <path d="M36 12C44 24 52 42 52 52" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />
            {/* Glossy reflection overlay */}
            <path d="M8 8L54 54" stroke="#FFF" strokeWidth="5" strokeLinecap="round" opacity="0.35" />
          </svg>
        </div>
      );

    // ---- WALL SURFACES ----
    // One card per style, and the card has to show the MATERIAL, not just its hue. These used to
    // be a single shared swatch: one colour lookup, the same dashed vertical stripes over every
    // one, and a paint-roller badge. That was honest while all seven walls really were the same
    // flat paint in different colours — it stopped being honest the moment wallMaterial.ts gave
    // each style brick, weave, boards or tile, and it could not have told 白刷磚牆 from 清水模灰牆
    // at all. The chrome (rounded swatch, corner curl, roller badge, glare) is still shared; only
    // the motif inside is per style.
    case 'wall-white':
    case 'wall-green':
    case 'wall-blue':
    case 'wall-pink':
    case 'wall-yellow':
    case 'wall-purple':
    case 'wall-red':
    case 'wall-wood-panel':
    case 'wall-brick-white':
    case 'wall-concrete':
    case 'wall-stripe-navy':
    case 'wall-terracotta':
    case 'wall-mint-tile': {
      // Ground colour of the card, and the ink its motif is drawn in. Kept next to each other so
      // a new style is one row here plus one motif below, not a hunt through three maps.
      const WALL_CARD: Record<string, { bg: string; ink: string }> = {
        'wall-white': { bg: '#FEFDF6', ink: '#E4DCC4' },
        'wall-green': { bg: '#A1B291', ink: '#7A8C6C' },
        'wall-blue': { bg: '#8CD9FC', ink: '#4FA6CE' },
        'wall-pink': { bg: '#FFEEF5', ink: '#EFA9C2' },
        'wall-yellow': { bg: '#FBDD6B', ink: '#D4B23C' },
        'wall-purple': { bg: '#E6D5FF', ink: '#BFA3E0' },
        'wall-red': { bg: '#A8503E', ink: '#C8BEB2' },
        'wall-wood-panel': { bg: '#6B4A33', ink: '#3D281A' },
        'wall-brick-white': { bg: '#F3EFE8', ink: '#CFC6B8' },
        'wall-concrete': { bg: '#B4B4B0', ink: '#8A8A86' },
        'wall-stripe-navy': { bg: '#F5F2EA', ink: '#25406B' },
        'wall-terracotta': { bg: '#C98461', ink: '#96513A' },
        'wall-mint-tile': { bg: '#A9DDCC', ink: '#E5E7E1' },
      };
      const card = WALL_CARD[currentId] || WALL_CARD['wall-white'];

      // Running-bond brick, shared by the fired-red and the limewashed white styles. Four
      // courses, alternate ones offset by half a brick — the offset IS the bond, and a brick
      // icon without it reads as a grid of boxes.
      const brickRows = [12, 24, 36, 48].map((y, i) => (
        <g key={`brick-${y}`}>
          <line x1="4" y1={y} x2="60" y2={y} stroke={card.ink} strokeWidth="2.5" strokeLinecap="round" />
          {(i % 2 === 0 ? [18, 32, 46] : [11, 25, 39, 53]).map((x) => (
            <line key={`${y}-${x}`} x1={x} y1={y} x2={x} y2={y + 12} stroke={card.ink} strokeWidth="2.5" strokeLinecap="round" />
          ))}
        </g>
      ));

      const motif: Record<string, React.ReactNode> = {
        // Satin stripe: barely-there bands, exactly as subtle as the wall is.
        'wall-white': (
          <g opacity="0.55">
            {[14, 26, 38, 50].map((x) => (
              <rect key={x} x={x} y="4" width="6" height="56" fill={card.ink} opacity="0.5" />
            ))}
          </g>
        ),
        // Limewash: cloudy brush passes, no hard edges anywhere.
        'wall-green': (
          <g opacity="0.6" strokeLinecap="round" fill="none" stroke={card.ink}>
            <path d="M8 18C18 12 30 22 40 15C48 9 54 14 58 12" strokeWidth="7" opacity="0.55" />
            <path d="M6 34C16 40 28 30 38 36C46 41 52 36 58 38" strokeWidth="9" opacity="0.45" />
            <path d="M8 50C20 45 32 54 44 48C50 45 54 48 58 47" strokeWidth="6" opacity="0.5" />
          </g>
        ),
        // Shiplap: horizontal boards with the shadow line under each.
        'wall-blue': (
          <g>
            {[16, 28, 40, 52].map((y) => (
              <g key={y}>
                <line x1="4" y1={y} x2="60" y2={y} stroke={card.ink} strokeWidth="3" strokeLinecap="round" />
                <line x1="4" y1={y + 3} x2="60" y2={y + 3} stroke="#FFF" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
              </g>
            ))}
          </g>
        ),
        // Sakura wallpaper: five petals on a staggered grid, same as the shader.
        'wall-pink': (
          <g>
            {[
              [18, 18], [42, 18], [30, 32], [18, 46], [42, 46],
            ].map(([cx, cy]) => (
              <g key={`${cx}-${cy}`}>
                {[0, 72, 144, 216, 288].map((a) => (
                  <ellipse
                    key={a}
                    cx={cx}
                    cy={cy - 4.6}
                    rx="2.6"
                    ry="4.2"
                    fill={card.ink}
                    transform={`rotate(${a} ${cx} ${cy})`}
                  />
                ))}
                <circle cx={cx} cy={cy} r="1.9" fill="#FBD89C" />
              </g>
            ))}
          </g>
        ),
        // Linen: a coarse basket weave, deliberately open enough to read at 64px.
        'wall-yellow': (
          <g stroke={card.ink} strokeWidth="2.5" opacity="0.65">
            {[12, 20, 28, 36, 44, 52].map((v) => (
              <g key={v}>
                <line x1={v} y1="4" x2={v} y2="60" />
                <line x1="4" y1={v} x2="60" y2={v} opacity="0.55" />
              </g>
            ))}
          </g>
        ),
        // Damask: one ogee motif, tone on tone.
        'wall-purple': (
          <g stroke={card.ink} fill="none" strokeWidth="2.5" strokeLinecap="round">
            <path d="M32 12C42 20 46 28 32 40C18 28 22 20 32 12Z" />
            <path d="M32 40C40 44 44 50 32 56C20 50 24 44 32 40Z" opacity="0.75" />
            <circle cx="32" cy="26" r="3" fill={card.ink} stroke="none" />
          </g>
        ),
        'wall-red': <g>{brickRows}</g>,
        'wall-brick-white': <g>{brickRows}</g>,
        // Walnut panelling: vertical boards, V groove between each.
        'wall-wood-panel': (
          <g>
            {[17, 30, 43].map((x) => (
              <g key={x}>
                <line x1={x} y1="4" x2={x} y2="60" stroke={card.ink} strokeWidth="3.5" strokeLinecap="round" />
                <line x1={x + 2.5} y1="4" x2={x + 2.5} y2="60" stroke="#A5764F" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
              </g>
            ))}
            {/* Grain, running along the boards */}
            <g stroke="#8C6242" strokeWidth="1.4" opacity="0.55" fill="none">
              <path d="M10 8C12 22 8 38 11 58" />
              <path d="M23 10C25 26 21 40 24 56" />
              <path d="M36 8C38 24 34 40 37 58" />
              <path d="M50 10C52 24 48 42 51 56" />
            </g>
          </g>
        ),
        // Board-formed concrete: form joints plus the four tie holes.
        'wall-concrete': (
          <g>
            <line x1="4" y1="32" x2="60" y2="32" stroke={card.ink} strokeWidth="2.5" />
            <line x1="32" y1="4" x2="32" y2="60" stroke={card.ink} strokeWidth="2.5" />
            {[[18, 18], [46, 18], [18, 46], [46, 46]].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#7C7C78" />
            ))}
          </g>
        ),
        // Regency stripe: broad navy bands with the gold pinstripe on each seam.
        'wall-stripe-navy': (
          <g>
            {[10, 30, 50].map((x) => (
              <rect key={x} x={x} y="4" width="10" height="56" fill={card.ink} />
            ))}
            {[8, 22, 28, 42, 48, 60].map((x) => (
              <line key={`p${x}`} x1={x} y1="4" x2={x} y2="60" stroke="#D4AF60" strokeWidth="1.6" />
            ))}
          </g>
        ),
        // Tadelakt: burnished patches, which is the whole character of the style.
        'wall-terracotta': (
          <g>
            <path d="M6 20C16 10 30 18 42 10C50 5 56 10 60 8" stroke={card.ink} strokeWidth="8" strokeLinecap="round" fill="none" opacity="0.5" />
            <path d="M4 42C16 36 28 46 40 40C48 36 54 40 60 38" stroke={card.ink} strokeWidth="10" strokeLinecap="round" fill="none" opacity="0.4" />
            {/* The polished sheen the trowel leaves */}
            <path d="M12 30C24 24 36 32 52 24" stroke="#FFF" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.4" />
            <path d="M16 52C26 48 38 54 50 50" stroke="#FFF" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.25" />
          </g>
        ),
        // Glazed square tile: grout grid, with a highlight on one tile's glaze.
        'wall-mint-tile': (
          <g>
            {[18, 32, 46].map((v) => (
              <g key={v}>
                <line x1={v} y1="4" x2={v} y2="60" stroke={card.ink} strokeWidth="3" />
                <line x1="4" y1={v} x2="60" y2={v} stroke={card.ink} strokeWidth="3" />
              </g>
            ))}
            <path d="M22 14L28 8" stroke="#FFF" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
            <path d="M36 42L42 36" stroke="#FFF" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
          </g>
        ),
      };

      return (
        <div className="relative w-full h-full flex items-center justify-center">
          <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <defs>
              <clipPath id={`wallCard-${currentId}`}>
                <rect x="4" y="4" width="56" height="56" rx="12" />
              </clipPath>
            </defs>

            {/* Stylized rounded wall swatch block */}
            <rect x="4" y="4" width="56" height="56" rx="12" fill={card.bg} />

            {/* The material itself, clipped to the card so brick courses and stripes run off the
                edge the way a real sample does rather than stopping short of the border. */}
            <g clipPath={`url(#wallCard-${currentId})`}>{motif[currentId]}</g>

            <rect x="4" y="4" width="56" height="56" rx="12" fill="none" stroke={strokeColor} strokeWidth="3" />

            {/* Subtle paper roll curl angle corner */}
            <path d="M52 4L60 12" stroke={strokeColor} strokeWidth="2.5" />
            <path d="M52 4H60V12H52V4Z" fill="#FFF" opacity="0.3" />

            {/* Cute Paint Roller icon in bottom corner indicating its application */}
            <g transform="translate(36, 36) scale(0.4)">
              <rect x="4" y="16" width="32" height="14" rx="4" fill="#3B82F6" stroke={strokeColor} strokeWidth="6" />
              <path d="M20 30V48M16 48H24" stroke={strokeColor} strokeWidth="6" strokeLinecap="round" />
              <path d="M36 23H44V40H20" stroke={strokeColor} strokeWidth="5" fill="none" />
            </g>

            {/* Glare streak reflection */}
            <path d="M12 6L50 44" stroke="#FFF" strokeWidth="4" strokeLinecap="round" opacity="0.35" />
          </svg>
        </div>
      );
    }

    // ---- FURNITURE ITEMS ----
    // `item-21` - 奢華沙發
    // The three blues ARE the model's three blues (Three/FurnitureItem.tsx's
    // LuxurySofaModel): seat #3B82F6, backrest #2563EB, arms #1D4ED8. The icon used to be a
    // cream-and-orange sofa on a wooden frame, which is a different piece of furniture from
    // the one that appears in the room when you place it - so the placement list and the shop
    // were advertising something the player never actually received.
    case 'item-21':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            {/* Armrests and base - the model's darkest blue */}
            <linearGradient id="blueSofaArmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
            {/* Backrest cushions - the model's mid blue */}
            <linearGradient id="blueSofaBackGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#2563EB" />
            </linearGradient>
            {/* Seat cushion - the model's seat blue */}
            <linearGradient id="blueSofaSeatGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#3B82F6" />
            </linearGradient>
            {/* Soft drop shadow inside the SVG */}
            <filter id="blueSofaShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2.5" stdDeviation="1.5" floodColor="#1E3A8A" floodOpacity="0.25" />
            </filter>
          </defs>

          <g filter="url(#blueSofaShadow)">
            {/* Base Frame */}
            <rect x="7" y="38" width="50" height="8" rx="4" fill="url(#blueSofaArmGrad)" stroke="#1E3A8A" strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M12 42H52" stroke="#DBEAFE" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />

            {/* Backrest Cushions */}
            {/* Left backrest */}
            <rect x="10" y="14" width="21" height="26" rx="8" fill="url(#blueSofaBackGrad)" stroke="#1E3A8A" strokeWidth="3.2" strokeLinejoin="round" />
            {/* Right backrest */}
            <rect x="33" y="14" width="21" height="26" rx="8" fill="url(#blueSofaBackGrad)" stroke="#1E3A8A" strokeWidth="3.2" strokeLinejoin="round" />

            {/* Tuft Buttons on Backrests */}
            <circle cx="20" cy="24" r="2.5" fill="#1E3A8A" />
            <circle cx="44" cy="24" r="2.5" fill="#1E3A8A" />

            {/* Cushion Highlights */}
            <path d="M13 18C16 18 18 19 18 21" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            <path d="M36 18C39 18 41 19 41 21" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />

            {/* Seat Cushion */}
            <rect x="8" y="31" width="48" height="11" rx="5" fill="url(#blueSofaSeatGrad)" stroke="#1E3A8A" strokeWidth="3.2" strokeLinejoin="round" />
            <line x1="32" y1="32" x2="32" y2="41" stroke="#1E3A8A" strokeWidth="2.2" strokeLinecap="round" opacity="0.25" />

            {/* Highlight line on Seat cushion */}
            <path d="M12 34H52" stroke="#EFF6FF" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />

            {/* Rounded Armrests */}
            {/* Left Armrest */}
            <rect x="3" y="24" width="9" height="18" rx="4" fill="url(#blueSofaArmGrad)" stroke="#1E3A8A" strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M5 28C7 28 8 29 8 31" stroke="#DBEAFE" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            {/* Right Armrest */}
            <rect x="52" y="24" width="9" height="18" rx="4" fill="url(#blueSofaArmGrad)" stroke="#1E3A8A" strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M54 28C56 28 57 29 57 31" stroke="#DBEAFE" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

            {/* Chubby Legs */}
            <path d="M14 46L11 53" stroke="#1E3A8A" strokeWidth="3.8" strokeLinecap="round" />
            <path d="M50 46L53 53" stroke="#1E3A8A" strokeWidth="3.8" strokeLinecap="round" />
          </g>
        </svg>
      );
    // `item-22` - 熱帶木桌
    // `item-22` — 熱帶木桌. A low island slab table. It used to SHARE this drawing with 橡木書桌
    // (item-desk), so the shop showed one identical picture for a 620g coffee table and a 680g
    // desk with a drawer bank. The desk now has its own case further down.
    case 'item-22':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="woodTableGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D97706" />
              <stop offset="100%" stopColor="#78350F" />
            </linearGradient>
          </defs>
          {/* Table Legs */}
          <path d="M16 26V54M48 26V54M24 26V48M40 26V48" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          {/* Table Top */}
          <rect x="6" y="16" width="52" height="12" rx="5" fill="url(#woodTableGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Wood grains detail */}
          <path d="M12 20H48" stroke="#FBBF24" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <path d="M18 24H36" stroke="#FBBF24" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        </svg>
      );
    // `item-chair` - 人體工學網椅
    case 'item-chair':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="chairBackGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#475569" />
              <stop offset="100%" stopColor="#1E293B" />
            </linearGradient>
            <linearGradient id="chairSeatGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#64748B" />
              <stop offset="100%" stopColor="#334155" />
            </linearGradient>
          </defs>
          {/* Five-star wheel base */}
          <path d="M20 52L24 48H40L44 52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M32 42V48" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          <circle cx="20" cy="53" r="2.5" fill="#334155" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="32" cy="53" r="2.5" fill="#334155" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="44" cy="53" r="2.5" fill="#334155" stroke={strokeColor} strokeWidth="1.5" />
          
          {/* Ergonomic Backrest */}
          <rect x="20" y="10" width="24" height="24" rx="6" fill="url(#chairBackGrad)" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Mesh patterns */}
          <line x1="24" y1="14" x2="40" y2="14" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="24" y1="18" x2="40" y2="18" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="24" y1="22" x2="40" y2="22" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="24" y1="26" x2="40" y2="26" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="24" y1="30" x2="40" y2="30" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />

          {/* Seat Cushion */}
          <rect x="16" y="32" width="32" height="8" rx="4" fill="url(#chairSeatGrad)" stroke={strokeColor} strokeWidth={strokeWidth} />
          
          {/* Curved Armrests */}
          <path d="M14 24V34H18" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M50 24V34H46" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    // `item-23` - 編織地毯
    // `deco-wall-rug` — 波西米亞編織地毯. The warm kilim with the diamond down the middle, which is
    // what `BohoRugModel` actually draws. 編織地毯 (item-23) used to share it despite its model
    // being a pale two-tone mat; it has its own case further down now.
    case 'deco-wall-rug':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Knotted fringes on the short ends, like the model's. */}
          <path d="M4 22H9M4 28H9M4 34H9M4 40H9M55 22H60M55 28H60M55 34H60M55 40H60" stroke="#E8D5B7" strokeWidth="2.6" strokeLinecap="round" />
          {/* Terracotta ground and the cream field inside it. */}
          <rect x="8" y="16" width="48" height="32" rx="3" fill="#B8543C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="12" y="20" width="40" height="24" rx="1.5" fill="#F0DCC0" stroke={strokeColor} strokeWidth="1.8" />
          {/* Central diamond with its amber core, and the two flanking lozenges. */}
          <path d="M32 22L41 32L32 42L23 32Z" fill="#3F6F6A" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M32 27L36 32L32 37L28 32Z" fill="#E0A24A" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M17 27L22 32L17 37L12 32Z" fill="#3F6F6A" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M47 27L52 32L47 37L42 32Z" fill="#3F6F6A" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    // `item-24` - 海風書架
    case 'item-24':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Bookcase Body */}
          <rect x="10" y="8" width="44" height="48" rx="4" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Shelves */}
          <line x1="10" y1="24" x2="54" y2="24" stroke={strokeColor} strokeWidth={strokeWidth} />
          <line x1="10" y1="40" x2="54" y2="40" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Books Shelf 1 */}
          <rect x="14" y="12" width="6" height="12" fill="#3B82F6" stroke={strokeColor} strokeWidth="2" />
          <rect x="20" y="14" width="5" height="10" fill="#EF4444" stroke={strokeColor} strokeWidth="2" />
          <rect x="25" y="12" width="7" height="12" fill="#FBBF24" stroke={strokeColor} strokeWidth="2" />
          {/* Books Shelf 2 */}
          <rect x="36" y="28" width="6" height="12" fill="#10B981" stroke={strokeColor} strokeWidth="2" />
          <path d="M42 40L47 29L51 31L46 40Z" fill="#F472B6" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );
    // `item-25` - 貝殼裝飾台
    case 'item-25':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Table Stand */}
          <rect x="20" y="38" width="24" height="18" rx="4" fill="#64748B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <line x1="20" y1="44" x2="44" y2="44" stroke={strokeColor} strokeWidth="2" />
          {/* Glass dome cover */}
          <path d="M16 38C16 22 24 14 32 14C40 14 48 22 48 38H16Z" fill="#E0F2FE" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" opacity="0.8" />
          {/* Golden Shell inside */}
          <path d="M26 36C26 36 26 26 32 26C38 26 38 36 32 38C29 37 26 36 26 36Z" fill="#FBBF24" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M29 36V28M32 38V26M35 36V28" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    // `item-30` - 復古提燈
    case 'item-30':
    case 'light-style-warm':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Metal Top loop */}
          <circle cx="32" cy="14" r="5" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Cap */}
          <path d="M22 22H42L38 18H26L22 22Z" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Glass Lantern casing */}
          <path d="M20 22L24 44H40L44 22H20Z" fill="#FEF08A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Glowing flame */}
          <path d="M32 28C30 31 30 36 32 38C34 36 34 31 32 28Z" fill="#F59E0B" stroke={strokeColor} strokeWidth="2" />
          <path d="M32 32C31 33 31 36 32 37C33 36 33 33 32 32Z" fill="#EF4444" />
          {/* Metal base */}
          <rect x="22" y="44" width="20" height="6" rx="2" fill="#78350F" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Protection cage bars */}
          <path d="M26 22V44M38 22V44" stroke={strokeColor} strokeWidth="1.5" opacity="0.6" />
        </svg>
      );
    // `item-31` - 石製路燈
    case 'item-31':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Stone column base */}
          <rect x="26" y="32" width="12" height="24" rx="2" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="22" y="52" width="20" height="6" rx="2" fill="#64748B" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Stone hood top */}
          <path d="M18 20L32 10L46 20H18Z" fill="#475569" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Glowing orb lamp */}
          <circle cx="32" cy="26" r="8" fill="#FCD34D" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="32" cy="26" r="3" fill="#FFF" />
          {/* Stone supports */}
          <path d="M20 20L26 32M44 20L38 32" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    // `item-36` - 竹製手電筒
    case 'item-36':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Bamboo cylinder */}
          <rect x="18" y="26" width="28" height="16" rx="4" fill="#84CC16" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(-35 32 34)" />
          {/* Segment lines */}
          <path d="M28 23L35 33M38 16L45 26" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          {/* Light beam */}
          <path d="M46 12L58 4M42 22L54 26" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <path d="M48 10L56 16" stroke="#FEF08A" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    // `item-37` - 螢光石燈
    case 'item-37':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Base plate */}
          <path d="M14 50H50L44 56H20L14 50Z" fill="#475569" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Glowing magical crystal cluster */}
          <path d="M32 12L42 34H22L32 12Z" fill="#22D3EE" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M22 24L32 44H12L22 24Z" fill="#06B6D4" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M44 28L52 46H36L44 28Z" fill="#0891B2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Highlight line */}
          <path d="M32 16V34" stroke="#FFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
          {/* Magic sparkles */}
          <circle cx="50" cy="18" r="2" fill="#E0F7FA" />
          <circle cx="16" cy="16" r="1.5" fill="#E0F7FA" />
        </svg>
      );
    // `item-torch` / `item-20` - 部落火把 / 火把
    case 'item-torch':
    case 'item-20':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Wooden pole standing angled */}
          <path d="M24 56L40 24" stroke={strokeColor} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M35 34L45 28" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" />
          {/* Fire wrapping container */}
          <rect x="36" y="16" width="10" height="10" rx="2" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Big Cute animated-style flame */}
          <path d="M41 4C41 4 48 10 46 18C44 24 38 24 38 18C38 14 41 4 41 4Z" fill="#F97316" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M41 8C41 8 45 12 44 18C43 21 39 21 39 18C39 15 41 8 41 8Z" fill="#FBBF24" />
        </svg>
      );

    // ---- LIGHTING CHANDELIERS ----
    case 'light-crystal':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Chain */}
          <line x1="32" y1="4" x2="32" y2="18" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          {/* Golden base hanger */}
          <path d="M16 22C16 22 22 18 32 18C42 18 48 22 48 22" stroke={strokeColor} strokeWidth={strokeWidth} fill="none" />
          {/* Dangling Crystals */}
          <path d="M20 22L20 42L24 46L28 42L28 22" fill="#38BDF8" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M32 22L32 46L36 50L40 46L40 22" fill="#FFF" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M44 22L44 40L48 44L52 40L52 22" fill="#38BDF8" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          {/* sparkle sparks */}
          <circle cx="14" cy="36" r="2" fill="#FBBF24" />
          <circle cx="50" cy="42" r="1.5" fill="#FBBF24" />
        </svg>
      );
    case 'light-industrial':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Thick cord */}
          <line x1="32" y1="4" x2="32" y2="24" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Iron Dome lamp shade */}
          <path d="M14 36C14 26 22 24 32 24C42 24 50 26 50 36H14Z" fill="#1E293B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Edison Bulb glowing inside */}
          <circle cx="32" cy="42" r="6" fill="#FCD34D" stroke={strokeColor} strokeWidth="2" />
          <line x1="32" y1="36" x2="32" y2="42" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'light-modern':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Hanging cords */}
          <line x1="24" y1="4" x2="24" y2="26" stroke={strokeColor} strokeWidth="1.5" />
          <line x1="40" y1="4" x2="40" y2="26" stroke={strokeColor} strokeWidth="1.5" />
          {/* Sleek Golden double rings */}
          <ellipse cx="32" cy="30" rx="20" ry="6" fill="none" stroke="#FBBF24" strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="40" rx="16" ry="5" fill="none" stroke="#D97706" strokeWidth={strokeWidth} />
          {/* Tiny modern hanging bulbs */}
          <circle cx="20" cy="30" r="3.5" fill="#FEF08A" stroke={strokeColor} strokeWidth="2" />
          <circle cx="44" cy="30" r="3.5" fill="#FEF08A" stroke={strokeColor} strokeWidth="2" />
          <circle cx="32" cy="40" r="3" fill="#FEF08A" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );
    case 'light-natural':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <line x1="32" y1="4" x2="32" y2="20" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Rattan woven round shade */}
          <circle cx="32" cy="36" r="16" fill="#E5A65D" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Weave texture crosshatch */}
          <path d="M20 30C26 34 38 34 44 30M18 36C26 42 38 42 46 36" stroke="#9C663D" strokeWidth="2" strokeLinecap="round" />
          <path d="M26 22V50M38 22V50" stroke="#9C663D" strokeWidth="2" strokeLinecap="round" />
          {/* Soft light peeking bottom */}
          <ellipse cx="32" cy="48" rx="6" ry="2" fill="#FEF08A" />
        </svg>
      );
    case 'light-style-natural':
    case 'light-style-white':
      const lightTempColors: Record<string, string> = {
        'light-style-natural': '#FEF08A',
        'light-style-white': '#E0F2FE'
      };
      const tColor = lightTempColors[currentId] || '#FEF08A';
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Light bulb radiating temperature waves */}
          <circle cx="32" cy="24" r="14" fill={tColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="27" y="38" width="10" height="6" rx="2" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Radiating arcs */}
          <path d="M12 24C12 20 16 12 22 10M52 24C52 20 48 12 42 10" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        </svg>
      );

    // ---- DECORATIVE OUTDOOR/INDOOR ITEMS ----
    case 'deco-surfboard':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="surfGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#0369A1" />
            </linearGradient>
          </defs>
          {/* Cool tropical surfboard */}
          <path d="M32 6C32 6 42 18 42 38C42 48 37 54 32 58C27 54 22 48 22 38C22 18 32 6 32 6Z" fill="url(#surfGrad)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Dynamic flame stripe design */}
          <path d="M32 6C32 6 36 20 28 34C24 41 24 50 32 58" stroke="#F59E0B" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M32 6C32 6 28 20 34 34C38 41 38 50 32 58" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'deco-radio':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Rounded pink retro radio body */}
          <rect x="10" y="18" width="44" height="34" rx="8" fill="#EC4899" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Metallic handle */}
          <path d="M22 18V12C22 10 24 8 26 8H38C40 8 42 10 42 12V18" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
          {/* Antenna */}
          <line x1="46" y1="18" x2="54" y2="6" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          <circle cx="54" cy="6" r="3" fill="#F43F5E" />
          {/* Speaker circles */}
          <circle cx="24" cy="36" r="10" fill="#FFF" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="24" cy="36" r="5" fill="#3D2A1C" />
          {/* Controlling dials */}
          <rect x="40" y="24" width="8" height="6" rx="2" fill="#FDE047" stroke={strokeColor} strokeWidth="2" />
          <rect x="40" y="34" width="8" height="6" rx="2" fill="#FEF08A" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );
    case 'deco-bonsai':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Potted Ceramic container */}
          <rect x="18" y="44" width="28" height="12" rx="4" fill="#F1F5F9" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Soil */}
          <ellipse cx="32" cy="44" rx="13" ry="2" fill="#78350F" />
          {/* Cute winding miniature palm trunk */}
          <path d="M32 44C32 44 26 34 32 26C35 22 30 18 32 12" stroke="#9C663D" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          {/* Lush miniature coconut palm leaves */}
          <path d="M32 12C32 12 18 10 14 16" stroke="#22C55E" strokeWidth="4" strokeLinecap="round" />
          <path d="M32 12C32 12 46 10 50 16" stroke="#22C55E" strokeWidth="4" strokeLinecap="round" />
          <path d="M32 12C32 12 28 2 28 1" stroke="#4ADE80" strokeWidth="3.5" strokeLinecap="round" />
          {/* Little green plant sprouts in pot */}
          <path d="M22 42C20 40 20 44 22 44Z" fill="#15803D" />
        </svg>
      );

    // ---- BATHROOM ITEMS ----
    case 'item-toilet':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Back tank */}
          <rect x="12" y="10" width="18" height="26" rx="4" fill="#F8FAFC" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Glowing flushing button */}
          <circle cx="21" cy="18" r="3" fill="#38BDF8" stroke={strokeColor} strokeWidth="1.5" />
          {/* Toilet Bowl */}
          <path d="M20 28H48C52 28 54 36 50 44C47 48 40 52 34 52H20V28Z" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Toilet Lid seat ring */}
          <ellipse cx="34" cy="30" rx="14" ry="4" fill="#FFF" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );
    case 'item-washbasin':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Cabinet stand */}
          <rect x="14" y="28" width="36" height="26" rx="4" fill="#64748B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <line x1="32" y1="28" x2="32" y2="54" stroke={strokeColor} strokeWidth="2" />
          {/* Marble Basin Bowl */}
          <ellipse cx="32" cy="26" rx="18" ry="6" fill="#F8FAFC" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Chrome faucet tap with a tiny water drop */}
          <path d="M32 20V12H36" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="32" cy="24" r="1.5" fill="#38BDF8" />
        </svg>
      );
    case 'item-bathtub':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Clawfoot golden legs */}
          <path d="M16 48V54M48 48V54" stroke="#FBBF24" strokeWidth="4.5" strokeLinecap="round" />
          {/* Deep white curved tub */}
          <path d="M8 20V36C8 44 14 48 24 48H40C50 48 56 44 56 36V20H8Z" fill="#F8FAFC" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Top rim ellipse */}
          <ellipse cx="32" cy="20" rx="24" ry="6" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Fluffy soap bubbles */}
          <circle cx="20" cy="18" r="4" fill="#FFF" opacity="0.9" />
          <circle cx="25" cy="16" r="3" fill="#E0F2FE" opacity="0.8" />
          <circle cx="42" cy="18" r="4.5" fill="#FFF" opacity="0.9" />
          {/* Tap shower */}
          <path d="M52 20V12H48" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      );

    // ---- KITCHEN ITEMS ----
    // `item-cupboard` — 廚房吊櫃, the glazed wall unit `HangingCabinetModel` draws. 系統流理台
    // (item-cabinet) used to share it, which was the clearest of the three mix-ups: its model is a
    // white counter with a stainless top, a sink and a faucet, and nothing here is any of that.
    case 'item-cupboard':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Kitchen Cupboard shelf storage */}
          <rect x="10" y="10" width="44" height="44" rx="4" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <line x1="10" y1="30" x2="54" y2="30" stroke={strokeColor} strokeWidth="2.5" />
          {/* Sliding Glass Doors */}
          <rect x="14" y="14" width="16" height="12" rx="2" fill="#E0F2FE" stroke={strokeColor} strokeWidth="2" opacity="0.6" />
          <rect x="34" y="14" width="16" height="12" rx="2" fill="#E0F2FE" stroke={strokeColor} strokeWidth="2" opacity="0.6" />
          {/* Little plates inside shelf */}
          <circle cx="20" cy="42" r="5" fill="#FCA5A5" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="26" cy="42" r="5" fill="#FEF08A" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="38" cy="42" r="6" fill="#93C5FD" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'item-fridge':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Cute tall double door pastel blue fridge */}
          <rect x="14" y="8" width="36" height="48" rx="8" fill="#BAE6FD" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Horizontal door split */}
          <line x1="14" y1="28" x2="50" y2="28" stroke={strokeColor} strokeWidth="2.5" />
          {/* Door Handles */}
          <rect x="18" y="14" width="4" height="10" rx="2" fill="#38BDF8" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="18" y="32" width="4" height="12" rx="2" fill="#38BDF8" stroke={strokeColor} strokeWidth="1.5" />
          {/* Cute food magnets on door */}
          <rect x="36" y="14" width="6" height="6" rx="2" fill="#F87171" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="42" cy="22" r="3.5" fill="#4ADE80" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'item-stove':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="10" y="14" width="44" height="38" rx="6" fill="#334155" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Two Gas Burners with blue fire */}
          <circle cx="22" cy="26" r="6" fill="#1E293B" stroke={strokeColor} strokeWidth="2" />
          <circle cx="22" cy="26" r="3" fill="#38BDF8" />
          <circle cx="42" cy="26" r="6" fill="#1E293B" stroke={strokeColor} strokeWidth="2" />
          <circle cx="42" cy="26" r="3" fill="#38BDF8" />
          {/* Oven view on bottom half */}
          <rect x="14" y="38" width="36" height="10" rx="2" fill="#0F172A" stroke={strokeColor} strokeWidth="2" />
          {/* Dialers */}
          <circle cx="24" cy="10" r="2.5" fill="#FFF" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="40" cy="10" r="2.5" fill="#FFF" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );

    // ---- BEDROOM & SLEEPING ITEMS ----
    case 'item-bed':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="doubleBedWood" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#8B5A2B" />
              <stop offset="100%" stopColor="#5C3A21" />
            </linearGradient>
            <linearGradient id="bedSpread" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F9A8D4" />
              <stop offset="100%" stopColor="#F43F5E" />
            </linearGradient>
          </defs>
          {/* Large Double Bed Headboard */}
          <rect x="6" y="10" width="52" height="22" rx="6" fill="url(#doubleBedWood)" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Fluffy mattress and sheets */}
          <rect x="8" y="24" width="48" height="28" rx="6" fill="url(#bedSpread)" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Folded blanket */}
          <rect x="8" y="38" width="48" height="14" rx="2" fill="#FFF" stroke={strokeColor} strokeWidth={strokeWidth} opacity="0.9" />
          {/* Cozy Pillows */}
          <rect x="14" y="18" width="16" height="10" rx="3" fill="#FFFBEB" stroke={strokeColor} strokeWidth="2" />
          <rect x="34" y="18" width="16" height="10" rx="3" fill="#FFFBEB" stroke={strokeColor} strokeWidth="2" />
          {/* Bed posts feet */}
          <path d="M10 52V58M54 52V58" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    case 'item-wardrobe':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Elegant wooden closet */}
          <rect x="12" y="8" width="40" height="48" rx="6" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Split doors */}
          <line x1="32" y1="8" x2="32" y2="48" stroke={strokeColor} strokeWidth="2.5" />
          {/* Handles */}
          <rect x="28" y="24" width="3" height="8" rx="1.5" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="33" y="24" width="3" height="8" rx="1.5" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.5" />
          {/* Bottom drawer drawer knob */}
          <line x1="12" y1="48" x2="52" y2="48" stroke={strokeColor} strokeWidth="2.5" />
          <circle cx="32" cy="52" r="2.5" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'item-nightstand':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Wood nightstand drawer box */}
          <rect x="16" y="22" width="32" height="30" rx="4" fill="#D97706" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Segment Drawer Line */}
          <line x1="16" y1="36" x2="48" y2="36" stroke={strokeColor} strokeWidth="2" />
          {/* Cute gold knobs */}
          <circle cx="32" cy="29" r="2.5" fill="#FEF08A" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="32" cy="44" r="2.5" fill="#FEF08A" stroke={strokeColor} strokeWidth="1.5" />
          {/* Stand feet */}
          <path d="M20 52V57M44 52V57" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          {/* Cute miniature lamp glowing on nightstand */}
          <path d="M26 22H38L32 14H26" stroke={strokeColor} strokeWidth="1.5" fill="#FFF" />
          <circle cx="32" cy="11" r="3" fill="#FCD34D" />
        </svg>
      );

    // ---- GENERAL UTILITY & STORAGE ITEMS ----
    case 'item-crate':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Cute wood packing box with criss-cross stripes */}
          <rect x="10" y="10" width="44" height="44" rx="4" fill="#D29965" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Inner border */}
          <rect x="14" y="14" width="36" height="36" stroke={strokeColor} strokeWidth="2" fill="none" />
          {/* Cross bands */}
          <line x1="14" y1="14" x2="50" y2="50" stroke={strokeColor} strokeWidth="3" />
          <line x1="50" y1="14" x2="14" y2="50" stroke={strokeColor} strokeWidth="3" />
        </svg>
      );
    case 'item-rack':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Industrial metal framing posts */}
          <rect x="12" y="8" width="40" height="48" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Metal Shelf levels */}
          <line x1="12" y1="24" x2="52" y2="24" stroke={strokeColor} strokeWidth="3" />
          <line x1="12" y1="40" x2="52" y2="40" stroke={strokeColor} strokeWidth="3" />
          {/* Colorful cargo boxes stacked */}
          <rect x="16" y="42" width="14" height="12" rx="2" fill="#F43F5E" stroke={strokeColor} strokeWidth="2" />
          <rect x="34" y="42" width="14" height="12" rx="2" fill="#3B82F6" stroke={strokeColor} strokeWidth="2" />
          <rect x="22" y="26" width="20" height="12" rx="2" fill="#10B981" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // ---- HISTORIC / GENERAL BUILDING ITEMS ----
    case 'item-16': // 木製平台
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="8" y="24" width="48" height="22" rx="4" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Wood slats */}
          <line x1="18" y1="24" x2="18" y2="46" stroke={strokeColor} strokeWidth="2" />
          <line x1="28" y1="24" x2="28" y2="46" stroke={strokeColor} strokeWidth="2" />
          <line x1="38" y1="24" x2="38" y2="46" stroke={strokeColor} strokeWidth="2" />
          <line x1="46" y1="24" x2="46" y2="46" stroke={strokeColor} strokeWidth="2" />
          {/* Tea set cup on deck */}
          <rect x="22" y="16" width="6" height="8" rx="1" fill="#FFF" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M28 18C29 18 30 19 30 20C30 21 29 22 28 22" stroke={strokeColor} strokeWidth="1.5" fill="none" />
        </svg>
      );
    case 'item-17': // 噴泉
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* fountain base basin */}
          <ellipse cx="32" cy="46" rx="20" ry="8" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Pillar columns */}
          <rect x="28" y="24" width="8" height="22" fill="#cbd5e1" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Upper bowl */}
          <ellipse cx="32" cy="24" rx="12" ry="5" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Sparkling Spraying water jets */}
          <path d="M32 20C32 20 24 10 16 26" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M32 20C32 20 40 10 48 26" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M32 14C32 14 30 4 32 4C34 4 32 14 32 14" stroke="#7DD3FC" strokeWidth="3.5" fill="none" />
        </svg>
      );
    case 'item-18': // 椰子樹
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Curved palm trunk */}
          <path d="M24 56C24 56 34 38 30 22" stroke="#9C663D" strokeWidth="5" strokeLinecap="round" fill="none" />
          {/* Ring markings */}
          <path d="M25 48L29 46M28 38L32 36" stroke={strokeColor} strokeWidth="1.5" />
          {/* Palm leaves */}
          <path d="M30 22C30 22 14 20 8 28" stroke="#22C55E" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M30 22C30 22 46 20 52 28" stroke="#22C55E" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M30 22C30 22 26 6 24 4" stroke="#4ADE80" strokeWidth="4" strokeLinecap="round" />
          {/* Cute hanging brown coconuts */}
          <circle cx="26" cy="24" r="3.5" fill="#78350F" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="32" cy="25" r="3.5" fill="#78350F" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'item-19': // 吊床
      /*
        舊圖把吊床畫成「兩根柱子之間拉一條細繩，繩上加交叉網格」—— 一張**網**。模型不是網，是一
        整片米色帆布織帶（HammockModel 的五段 OUT_CANVAS 布片加兩端的撐木）。細繩加網格在 40px 的
        商店卡上讀成一條攔繩，跟擺出來的東西是兩種材質、兩種量體。

        現在畫的就是模型的那五個零件：腳座／柱身／尖帽的立柱、柱頂垂下來的吊繩、有厚度的帆布、
        兩端撐開布面的橫木，以及躺姿頭那一端的黃色抱枕。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 立柱：腳座、柱身、尖帽 */}
          <rect x="7" y="48.5" width="12" height="4.5" rx="2" fill="#573818" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="45" y="48.5" width="12" height="4.5" rx="2" fill="#573818" stroke={strokeColor} strokeWidth="1.4" />
          <path d="M13 49.5V21M51 49.5V21" stroke="#7A5228" strokeWidth="5" strokeLinecap="round" />
          <path d="M9.2 21L13 13L16.8 21Z" fill="#A0713D" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M47.2 21L51 13L54.8 21Z" fill="#A0713D" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
          {/* 吊繩，柱頂斜下接到織帶收攏的那一頭 */}
          <path d="M13 20L19.5 28M51 20L44.5 28" stroke="#B08A4A" strokeWidth="2.2" strokeLinecap="round" />
          {/* 帆布織帶。有厚度的一整片，不是一條線 —— 這就是「吊床」跟「攔繩」的差別 */}
          <path d="M19 28Q32 45 45 28L45 37Q32 54 19 37Z" fill="#EFE3CB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* 兩道織紋橫肋（模型也只有兩道） */}
          <path d="M26.5 35.3V44.3M37.5 35.3V44.3" stroke="#B08A4A" strokeWidth="1.8" strokeLinecap="round" />
          {/* 兩端撐開布面的橫木 */}
          <rect x="16.4" y="25.5" width="4.6" height="13" rx="2.2" fill="#A0713D" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="43" y="25.5" width="4.6" height="13" rx="2.2" fill="#A0713D" stroke={strokeColor} strokeWidth="1.6" />
          {/* 抱枕 */}
          <rect x="32.5" y="28.5" width="11.5" height="7.5" rx="3.2" fill="#F5C85C" stroke={strokeColor} strokeWidth="1.7" transform="rotate(16 38.25 32.25)" />
        </svg>
      );
    case 'deco-swing':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* A-frame wooden posts */}
          <path d="M14 54L26 10M50 54L38 10" stroke="#78350F" strokeWidth="4.5" strokeLinecap="round" />
          {/* Top beam */}
          <path d="M22 14H42" stroke="#78350F" strokeWidth="5" strokeLinecap="round" />
          {/* Ropes */}
          <path d="M27 15L22 38M37 15L42 38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          {/* Swaying seat plank */}
          <rect x="18" y="38" width="28" height="6" rx="2" fill="#EAB676" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(-6 32 41)" />
        </svg>
      );
    case 'deco-campfire':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="flameGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#EF4444" />
              <stop offset="60%" stopColor="#F97316" />
              <stop offset="100%" stopColor="#FDE047" />
            </linearGradient>
          </defs>
          {/* Stone ring */}
          <circle cx="18" cy="48" r="4" fill="#94A3B8" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="32" cy="52" r="4" fill="#94A3B8" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="46" cy="48" r="4" fill="#94A3B8" stroke={strokeColor} strokeWidth="1.5" />
          {/* Crossed logs */}
          <rect x="16" y="42" width="32" height="4" rx="2" fill="#78350F" stroke={strokeColor} strokeWidth="1.5" transform="rotate(-8 32 44)" />
          <rect x="16" y="42" width="32" height="4" rx="2" fill="#92400E" stroke={strokeColor} strokeWidth="1.5" transform="rotate(8 32 44)" />
          {/* Flickering flame */}
          <path d="M32 44C32 44 20 34 26 22C28 26 30 27 30 24C30 16 36 10 34 4C42 12 44 22 38 28C40 27 41 24 41 21C46 28 44 38 32 44Z" fill="url(#flameGrad)" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'deco-telescope':
      /*
        商品名字裡有「望遠鏡」，但玩家先要認得的其實是**三腳架**——那是它在一排戶外裝飾裡唯一的
        辨識形狀。舊圖的三腳架是三筆 3.5 寬的細線、只佔畫面下緣的一小塊，而且被那根 34 長的鏡筒
        整個壓過去；剩下的讀感是「一根橘色棒子頂著一顆藍球」，像一支棒棒糖。

        現在三腳架是主結構：三隻腳從雲台張開到模型自己的比例（TRIPOD_FOOT_R 0.40 對雲台高
        TELESCOPE_YOKE_Y 0.92，約 24 度），下半部有一圈把三隻腳連起來的撐條 —— 那圈撐條是「這是
        一支腳架」而不是「三根插在地上的棍子」的來源，模型也有（TRIPOD_BRACES）。

        鏡筒照模型畫成一根**錐管**：物鏡端細（TUBE_R_TOP 0.10）、目鏡端粗（TUBE_R_BOTTOM 0.14），
        兩道銅箍、一支尋星鏡、末端的深色目鏡，傾角 32 度（模型的 rotation.z −0.55 弧度）。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 後腳，畫在最底層、深一階，讓三隻腳讀得出前後 */}
          <path d="M28 31L30.5 53" stroke="#573818" strokeWidth="3.4" strokeLinecap="round" />
          {/* 左右兩隻前腳 */}
          <path d="M28 31L15 54M28 31L41 54" stroke="#7A5228" strokeWidth="3.8" strokeLinecap="round" />
          {/* 撐條：把三隻腳在下半部連成一個三角形 */}
          <path d="M20.3 45L29.6 47.1L36.7 45" stroke="#573818" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {/* 鏡筒。整組繞雲台傾斜，跟模型同一個角度 */}
          <g transform="rotate(-32 28 31)">
            {/* 目鏡 —— 沒有它，這根管子兩頭都是開的，看不出來要從哪裡看 */}
            <rect x="24.6" y="31" width="6.8" height="6" rx="1.6" fill="#1E293B" stroke={strokeColor} strokeWidth="1.6" />
            {/* 錐管本體：上細下粗 */}
            <path d="M23.9 32L32.1 32L30.7 11.5L25.3 11.5Z" fill="#F59E0B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            {/* 兩道銅箍，都比鏡筒表面再站出來一點 */}
            <rect x="23.2" y="26.5" width="9.6" height="3" rx="1" fill="#8A6A2A" stroke={strokeColor} strokeWidth="1.3" />
            <rect x="24.5" y="16" width="7" height="3" rx="1" fill="#8A6A2A" stroke={strokeColor} strokeWidth="1.3" />
            {/* 物鏡端的鏡圈與鏡片 */}
            <rect x="24.4" y="8.5" width="7.2" height="3.5" rx="1.4" fill="#1E293B" stroke={strokeColor} strokeWidth="1.5" />
            <ellipse cx="28" cy="10.2" rx="2.4" ry="1.1" fill="#BAE6FD" />
            {/* 尋星鏡，架在主鏡筒側上方 */}
            <rect x="31.6" y="14" width="3.4" height="9" rx="1.5" fill="#C8A24A" stroke={strokeColor} strokeWidth="1.4" />
          </g>
          {/* 雲台與對焦旋鈕，畫在鏡筒之後，所以腳與筒都收在它下面 */}
          <circle cx="28" cy="31" r="4.4" fill="#D97706" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="32.6" cy="33.2" r="2.3" fill="#8A6A2A" stroke={strokeColor} strokeWidth="1.3" />
          {/* 一顆小星星，說明它是拿來做什麼的 */}
          <path d="M52 9L53.6 13.4L58 15L53.6 16.6L52 21L50.4 16.6L46 15L50.4 13.4Z" fill="#F5C542" stroke={strokeColor} strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'deco-birdhouse':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Post */}
          <path d="M32 56V32" stroke="#78350F" strokeWidth="4.5" strokeLinecap="round" />
          {/* House body */}
          <rect x="18" y="22" width="28" height="18" rx="3" fill="#EAB676" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Peaked roof */}
          <path d="M14 22L32 8L50 22H14Z" fill="#EF4444" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Round hole */}
          <circle cx="32" cy="31" r="4.5" fill="#3D2A1C" />
          {/* Tiny bird perched on roof peak */}
          <circle cx="40" cy="16" r="4" fill="#38BDF8" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M44 16L48 14.5L44 17.5Z" fill="#F97316" />
        </svg>
      );
    case 'deco-wishing-well':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Stone well base */}
          <path d="M12 46V34H52V46H12Z" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Shimmering water */}
          <ellipse cx="32" cy="34" rx="20" ry="5" fill="#38BDF8" stroke={strokeColor} strokeWidth="2" />
          {/* Stone texture lines */}
          <line x1="12" y1="40" x2="52" y2="40" stroke="#64748B" strokeWidth="1.5" />
          {/* Support posts */}
          <path d="M14 34V14M50 34V14" stroke="#78350F" strokeWidth="4" strokeLinecap="round" />
          {/* Peaked roof */}
          <path d="M8 16L32 4L56 16H8Z" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Hanging bucket on rope */}
          <path d="M32 12V26" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="27" y="26" width="10" height="8" rx="1.5" fill="#B45309" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );

    case 'deco-bench-garden':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M12 56V44M52 56V44M12 34V44M52 34V44" stroke="#78350F" strokeWidth="4" strokeLinecap="round" />
          <rect x="10" y="30" width="44" height="7" rx="2" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M12 34V16" stroke="#78350F" strokeWidth="4" strokeLinecap="round" />
          <rect x="10" y="14" width="8" height="20" rx="1.5" fill="#A0713D" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'deco-tree-stump-seat':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M14 56L18 24H46L50 56H14Z" fill="#A0713D" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="32" cy="24" rx="14" ry="5" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="24" rx="9" ry="3.2" fill="none" stroke="#7A5228" strokeWidth="1.5" />
          <ellipse cx="32" cy="24" rx="4.5" ry="1.6" fill="none" stroke="#7A5228" strokeWidth="1.5" />
        </svg>
      );
    case 'deco-camp-chair':
      /*
        四張坐臥類商品（木製躺椅／沙灘躺椅／小型露營椅／吊椅）舊圖都是「淺色布面加木框」的近似
        剪影，在商店的三欄格線裡幾乎分不出來。現在四張各自抓一個**只有自己有**的結構特徵：

          小型露營椅 → 交叉的 X 腳架 加 直立的高背（導演椅）
          木製躺椅   → 厚木橫板 加 扶手 加 四支腳把整張椅子架離地面
          沙灘躺椅   → 貼近地面的矮框 加 一整片平滑帆布 加 黃色頭枕
          吊椅       → 封閉的藤編蛋殼 加 C 形立架

        這一張是 X 腳架。舊圖的四道斜線交叉在座面**下方很遠**的地方，讀成一個梯形底座；模型
        （CampChairModel）的 X 是在座面正下方交叉的，兩側各一組。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 兩根扶手杆，從座面往上撐起靠背 */}
          <path d="M20 32V11M44 32V11" stroke="#7A5228" strokeWidth="3.4" strokeLinecap="round" />
          {/* 靠背帆布，繃在兩根杆之間 */}
          <rect x="20" y="10.5" width="24" height="16" rx="2" fill="#E3D4B6" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* 座面帆布 */}
          <rect x="15.5" y="27.5" width="33" height="5.5" rx="2" fill="#EFE3CB" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* 交叉腳架。這兩道線就是這張椅子跟另外三件的差別，所以畫得比其他線都粗 */}
          <path d="M18 50L45 33M46 50L19 33" stroke="#7A5228" strokeWidth="4" strokeLinecap="round" />
          {/* 腳墊 */}
          <rect x="13.5" y="48.5" width="9" height="4.5" rx="2" fill="#573818" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="41.5" y="48.5" width="9" height="4.5" rx="2" fill="#573818" stroke={strokeColor} strokeWidth="1.4" />
        </svg>
      );
    case 'deco-lounger-wood':
      /*
        舊圖是一組讀不出來的斜塊：一根深色的橫棒浮在右上角、跟下面的楔形完全沒有接觸，而且整個
        形狀超出畫面右緣被裁掉。四樣特徵一樣都沒有畫到。

        現在是模型（WoodLoungerModel）的側視：四支腳把椅子架離地面、厚實的木橫板、後仰 54 度
        （模型是 0.95 弧度）的靠背，以及**扶手** —— 扶手是這張躺椅在四件坐臥商品裡的專屬特徵，
        沙灘躺椅沒有、露營椅沒有、吊椅沒有。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 遠端的兩支腳，淺一階墊出厚度（模型是四支腳） */}
          <path d="M30 34V47M52 34V47" stroke="#A0713D" strokeWidth="3.4" strokeLinecap="round" />
          {/* 近端的兩支腳 */}
          <path d="M25 34V49M47 34V49" stroke="#573818" strokeWidth="4" strokeLinecap="round" />
          {/* 靠背：繞座面後端的鉸點往後上翹，三片橫板 */}
          <g transform="rotate(54 21 31)">
            <rect x="1.5" y="28.5" width="20" height="5" rx="2" fill="#7A5228" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
            <rect x="3.5" y="24.5" width="5.2" height="4.4" rx="1.2" fill="#C08B52" stroke={strokeColor} strokeWidth="1.4" />
            <rect x="10" y="24.5" width="5.2" height="4.4" rx="1.2" fill="#A0713D" stroke={strokeColor} strokeWidth="1.4" />
            <rect x="16.5" y="24.5" width="5.2" height="4.4" rx="1.2" fill="#C08B52" stroke={strokeColor} strokeWidth="1.4" />
          </g>
          {/* 座面側框 */}
          <rect x="19" y="29" width="36" height="5" rx="2" fill="#7A5228" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* 座面橫板，四片，深淺交錯 —— 模型的座面段也是四片 */}
          <rect x="21.5" y="25" width="6.6" height="4.4" rx="1.3" fill="#A0713D" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="29.9" y="25" width="6.6" height="4.4" rx="1.3" fill="#C08B52" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="38.3" y="25" width="6.6" height="4.4" rx="1.3" fill="#A0713D" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="46.7" y="25" width="6.6" height="4.4" rx="1.3" fill="#C08B52" stroke={strokeColor} strokeWidth="1.5" />
          {/* 扶手，架在座面上方 */}
          <path d="M25 25V20M46 25V20" stroke="#7A5228" strokeWidth="2.6" strokeLinecap="round" />
          <rect x="22.5" y="17.5" width="26" height="4" rx="2" fill="#A0713D" stroke={strokeColor} strokeWidth="1.8" />
        </svg>
      );
    case 'deco-lounger-beach':
      /*
        舊圖是一個底邊貼著畫面的米色梯形加兩根短腳 —— 讀起來是一張桌子或一頂帳篷，而且完全看不出
        「躺椅」需要的那個後仰角。

        模型（BeachLoungerModel）跟木製躺椅刻意做出的差別有三個，這張圖就照這三個畫：座面**貼近
        地面**（座高 0.28，木製躺椅是 0.40，所以這裡的腳只有那一張的一半）、面料是**一整片平滑的
        帆布條**而不是厚木板、以及頭那一端有一塊**黃色頭枕**。背後那根斜撐也是模型上真的有的零件。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 撐住靠背的斜撐 */}
          <path d="M22 39L15 47" stroke="#7A5228" strokeWidth="2.6" strokeLinecap="round" />
          {/* 靠背：後仰 52 度（模型是 0.85 弧度），一整片帆布，頂端一塊黃色頭枕。
              長度取 20（座面 33 的六成），跟模型 0.56 比 0.96 的比例一致 —— 畫短了就會讀成一張桌子。 */}
          <g transform="rotate(52 24 36)">
            <rect x="4" y="33" width="20" height="6" rx="2" fill="#EFE3CB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d="M10.5 33.9V38.1M17 33.9V38.1" stroke="#E3D4B6" strokeWidth="1.6" />
            <rect x="2.5" y="26.5" width="8.5" height="6.5" rx="2.6" fill="#F5C85C" stroke={strokeColor} strokeWidth="1.8" />
          </g>
          {/* 座面：三條帆布並排（模型也是三條），縫線是唯一的分隔，沒有木板的厚度 */}
          <rect x="22.5" y="33" width="33" height="5.5" rx="2" fill="#EFE3CB" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M33.5 34V37.5M44.5 34V37.5" stroke="#E3D4B6" strokeWidth="1.8" />
          {/* 矮腳。只有木製躺椅的一半高 —— 這是兩張躺椅最快分辨的地方 */}
          <path d="M27 38.5V46M51 38.5V46" stroke="#7A5228" strokeWidth="3.4" strokeLinecap="round" />
          <rect x="22.5" y="45" width="9" height="4" rx="2" fill="#573818" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="46.5" y="45" width="9" height="4" rx="2" fill="#573818" stroke={strokeColor} strokeWidth="1.4" />
        </svg>
      );
    case 'deco-hanging-chair':
      /*
        模型（HangingChairModel）是一個**正面開口的藤編吊籃**：C 形立架（配重底座、立柱、外伸的
        曲臂）、掛環、一根撐桿把兩條繩撐到籃子兩側，籃子裡一塊米色坐墊。

        以前的模型是一顆封閉的蛋、四條繩往中間收 —— 那顆蛋比坐進去的角色的頭還小，繩子穿過臉。
        模型按坐姿身體的尺寸重新比例之後，這張圖跟著改：籃子頂端是開的（有一圈籃緣），繩子接在
        兩側而不是收到頂上一點。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 配重底座，與伸到籃子下方的木腳 */}
          <ellipse cx="18" cy="53.5" rx="9.5" ry="3.4" fill="#573818" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M18 54H40" stroke="#573818" strokeWidth="3.2" strokeLinecap="round" />
          {/* 立柱與頂端橫伸的曲臂 */}
          <path d="M18 52.5V11" stroke="#7A5228" strokeWidth="4.4" strokeLinecap="round" />
          <path d="M18 9.5H40.5" stroke="#7A5228" strokeWidth="4.4" strokeLinecap="round" />
          {/* 吊鉤與掛環 */}
          <path d="M40.5 11V13.5" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="40.5" cy="15.2" r="2" fill="#8A6A2A" stroke={strokeColor} strokeWidth="1.3" />
          {/* 撐桿 */}
          <path d="M29 18.5H52" stroke="#B08A4A" strokeWidth="2.6" strokeLinecap="round" />
          {/* 兩條繩，從撐桿兩端接到籃緣兩側 */}
          <path d="M29.6 18.5L31 31M51.4 18.5L50 31" stroke="#B08A4A" strokeWidth="1.8" strokeLinecap="round" />
          {/* 吊籃本體 —— 頂端開口，下半是圓的籃子 */}
          <path d="M28.6 31C28.6 42.5 33.6 50.4 40.5 50.4C47.4 50.4 52.4 42.5 52.4 31Z" fill="#B08A4A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* 正面的開口，看得進去的深色內襯 */}
          <path d="M33.6 31C33.6 39.5 36.4 45.8 40.5 45.8C44.6 45.8 47.4 39.5 47.4 31Z" fill="#7A5228" />
          {/* 籃緣 */}
          <ellipse cx="40.5" cy="31" rx="11.9" ry="2.6" fill="none" stroke="#7A5228" strokeWidth="2.2" />
          {/* 坐墊 */}
          <ellipse cx="40.5" cy="37.8" rx="7" ry="2.7" fill="#EFE3CB" stroke={strokeColor} strokeWidth="1.5" />
          {/* 殼上的藤條肋 */}
          <path d="M31 34C31.4 40 33 44.5 35.5 47.4M50 34C49.6 40 48 44.5 45.5 47.4" stroke="#7A5228" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case 'deco-picnic-blanket':
      /*
        舊圖有三個問題，而且三個都指向同一件事：它畫的不是一張鋪在地上的毯子。

        1. **顏色是反的。** 模型（PicnicBlanketModel）是一整片紅底，只留出米色的格線與正中央一格；
           舊圖是米底加紅格。
        2. **格子只有四塊。** 舊的 CHECKS 陣列最後兩項跟前面重複（48 - 20 就是 28），六筆只畫得出
           四塊 —— 2x2 的紅格加一圈米色外框，讀起來是一扇**窗**。
        3. **正投影、貼滿整格。** 毯子是躺在地上的東西，一個正面朝前的正方形沒有「躺著」這個訊息，
           而且四邊都貼著畫框，看起來像被裁掉的。

        現在是躺在地上的透視菱形、紅底米線的 3x3、被風掀起的一角（模型的 corner 那一塊）、一圈
        流蘇，以及壓住一角的小石頭 —— 全部都是模型上真的有的東西。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 流蘇：比毯身大一圈的虛線邊 */}
          <path d="M32 9.5L59 29.5L32 49.5L5 29.5Z" stroke="#B08A4A" strokeWidth="2.4" strokeDasharray="2 2.6" fill="none" strokeLinejoin="round" />
          {/* 毯身 */}
          <path d="M32 13L56 29.5L32 46L8 29.5Z" fill="#E0503F" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* 米色格線，把毯面切成 3x3 —— 模型的八塊紅格加中央一塊米色就是這個圖案 */}
          <path d="M40 18.5L16 35M48 24L24 40.5M24 18.5L48 35M16 24L40 40.5" stroke="#EFE3CB" strokeWidth="2.6" />
          <path d="M32 24L40 29.5L32 35L24 29.5Z" fill="#EFE3CB" />
          {/* 被風掀起的一角，露出布的背面 */}
          <path d="M24 18.5L40 18.5L35.5 6.5L26 6Z" fill="#EFE3CB" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          {/* 壓角的小石頭 */}
          <path d="M11 27.8L14.8 26.8L16.4 29.6L13.6 31.8L10.6 30.8Z" fill="#94A3B8" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'deco-picnic-basket':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M20 56C16 56 14 52 14 44V34H50V44C50 52 48 56 44 56H20Z" fill="#B08A4A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M14 40H50M14 46H50" stroke="#7A5228" strokeWidth="1.5" />
          <path d="M18 24C18 24 24 34 32 24C40 34 46 24 46 24" stroke="#7A5228" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <rect x="22" y="28" width="20" height="8" fill="#EFE3CB" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="26" y="30" width="12" height="5" fill="#E0503F" />
        </svg>
      );
    case 'deco-picnic-table':
      // A 字腳, not crossed legs. The picture used to draw an X at each end while the row calls
      // this 「簡單的 A 字腳野餐桌」 and the model splays two legs from a shared apex — three
      // answers to one question. The A is also the only thing separating this from any other
      // four-legged table, so it is what the picture spends its width on: two legs from a top
      // apex out to the feet, with the stretcher that makes an A an A.
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {[15, 49].map((cx) => (
            <g key={cx}>
              <path d={`M${cx - 7} 56L${cx} 29M${cx + 7} 56L${cx} 29`} stroke="#7A5228" strokeWidth="4" strokeLinecap="round" />
              <path d={`M${cx - 4.4} 44H${cx + 4.4}`} stroke="#573818" strokeWidth="3" strokeLinecap="round" />
            </g>
          ))}
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={8 + i * 12} y="24" width="10" height="6" rx="1.5" fill={i % 2 === 0 ? '#A0713D' : '#C08B52'} stroke={strokeColor} strokeWidth="1" />
          ))}
        </svg>
      );
    case 'deco-viewing-deck':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="10" y="34" width="44" height="8" rx="1.5" fill="#573818" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M14 42V56M50 42V56" stroke="#3A2A1C" strokeWidth="4" strokeLinecap="round" />
          <path d="M14 34V18M50 34V18" stroke="#7A5228" strokeWidth="3" strokeLinecap="round" />
          <path d="M14 22H50M14 28H50" stroke="#A0713D" strokeWidth="2.5" />
          <path d="M22 34V16M42 34V16" stroke="#7A5228" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'deco-tent':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M8 54L32 12L56 54Z" fill="#EFE3CB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M32 12L24 54H40L32 12Z" fill="#3A2A1C" />
          <path d="M40 54L48 36L44 54Z" fill="#E3D4B6" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 54H56" stroke="#7A5228" strokeWidth="2" />
          <path d="M28 58H40" stroke="#B08A4A" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case 'deco-firewood-stack':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="8" y="42" width="48" height="10" rx="5" fill="#A0713D" stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="10" y="30" width="44" height="10" rx="5" fill="#7A5228" stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="14" y="18" width="36" height="10" rx="5" fill="#A0713D" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="12" cy="35" r="3.5" fill="#573818" />
          <circle cx="52" cy="23" r="3.5" fill="#573818" />
          <path d="M38 6L38 22" stroke="#7A5228" strokeWidth="3" strokeLinecap="round" />
          <path d="M34 4L44 4L42 12L36 12Z" fill="#C8A24A" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'deco-frisbee':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="32" cy="34" rx="24" ry="10" fill="#38BDF8" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="31" rx="24" ry="10" fill="#7DD3FC" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="31" rx="10" ry="4" fill="none" stroke="#FDFBF6" strokeWidth="2" />
        </svg>
      );
    case 'deco-beach-ball':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <circle cx="32" cy="32" r="22" fill="#FDFBF6" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M32 10A22 22 0 0 1 51 24L32 32Z" fill="#E0503F" />
          <path d="M51 24A22 22 0 0 1 45 50L32 32Z" fill="#F5C542" />
          <path d="M45 50A22 22 0 0 1 19 47L32 32Z" fill="#38BDF8" />
          <path d="M19 47A22 22 0 0 1 32 10L32 32Z" fill="#9B6FC9" />
        </svg>
      );
    case 'deco-tree-broadleaf':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M30 56V32" stroke="#7A5228" strokeWidth="5" strokeLinecap="round" />
          <circle cx="30" cy="24" r="18" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="42" cy="30" r="10" fill="#3F6A2A" />
          <circle cx="20" cy="14" r="9" fill="#6CB33F" />
        </svg>
      );
    case 'deco-tree-fruit':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M30 56V36" stroke="#A0713D" strokeWidth="5" strokeLinecap="round" />
          <circle cx="30" cy="26" r="16" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="24" cy="22" r="3.2" fill="#E2762F" stroke={strokeColor} strokeWidth="1" />
          <circle cx="36" cy="28" r="3.2" fill="#B85420" stroke={strokeColor} strokeWidth="1" />
          <circle cx="30" cy="34" r="3" fill="#E2762F" stroke={strokeColor} strokeWidth="1" />
        </svg>
      );
    case 'deco-tree-tropical':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V30" stroke="#7A5228" strokeWidth="5" strokeLinecap="round" />
          <path d="M32 30C32 30 14 26 8 32M32 30C32 30 12 16 10 8M32 30C32 30 26 10 32 4M32 30C32 30 38 10 32 4M32 30C32 30 52 16 54 8M32 30C32 30 50 26 56 32" stroke="#4A8F2E" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'deco-tree-dwarf':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V38" stroke="#A0713D" strokeWidth="4" strokeLinecap="round" />
          <circle cx="32" cy="28" r="14" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="32" cy="20" r="8" fill="#6CB33F" />
        </svg>
      );
    case 'deco-tree-blossom':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V32" stroke="#7A5228" strokeWidth="5" strokeLinecap="round" />
          <path d="M32 32L18 22M32 32L46 20M32 32L32 14" stroke="#A0713D" strokeWidth="3" strokeLinecap="round" />
          {[[18, 22], [46, 20], [32, 14], [24, 30], [40, 30]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="6.5" fill={i % 2 === 0 ? '#F4A6C1' : '#FDF6F0'} stroke={strokeColor} strokeWidth="1.2" />
          ))}
        </svg>
      );
    case 'deco-tree-driftwood':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V26" stroke="#E3D4B6" strokeWidth="5" strokeLinecap="round" />
          <path d="M32 40L18 26M32 34L48 22M32 26L24 12M32 26L42 10" stroke="#B08A4A" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      );
    case 'deco-tree-coastal':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M28 56L38 30" stroke="#7A5228" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="48" cy="26" rx="16" ry="8" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(-12 48 26)" />
          <ellipse cx="54" cy="20" rx="8" ry="5" fill="#6CB33F" transform="rotate(-12 54 20)" />
        </svg>
      );
    case 'deco-tree-bamboo':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {[16, 28, 40, 50].map((x, i) => (
            <rect key={i} x={x - 3} y={14 + (i % 2) * 8} width="6" height={44 - (i % 2) * 8} rx="3" fill={i % 2 === 0 ? '#4A8F2E' : '#3F6A2A'} stroke={strokeColor} strokeWidth="1.2" />
          ))}
          {[20, 44].map((y, i) => (
            <path key={i} d={`M10 ${y}H56`} stroke="#3F6A2A" strokeWidth="1.5" />
          ))}
          <path d="M16 14L8 8M50 14L58 8" stroke="#6CB33F" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'deco-shrub-round':
      /*
        跟著模型（Three/FurnitureItem.tsx 的 RoundShrubModel）一起改。舊圖是一顆 OUT_LEAF 的正圓
        加兩塊色斑，而那正是模型「擺下去看不見」的三個原因的圖示版：主色跟草地同一階明度、底部的
        枝條被埋在球裡、輪廓是一個沒有起伏的正圓。

        現在三件事都對上模型：面積最大的冠部改用最亮的一階（OUT_LEAF_LIGHT，對島上草地
        PLATEAU_INNER_COLOR 是 1.94:1，舊的只有 1.25:1）、底下露出短幹與深色土墩、冠的外緣由幾個
        真的凸出去的葉層構成而不是一條圓弧。
      */
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* 土墩：整張圖對比最高的一塊，把灌木釘在地面上 */}
          <ellipse cx="32" cy="52" rx="14" ry="4.6" fill="#573818" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* 露出來的短幹 */}
          <path d="M32 51V38" stroke="#7A5228" strokeWidth="6" strokeLinecap="round" />
          {/* 冠部的外層葉簇，先畫，主冠壓在上面 —— 露出來的弧就是輪廓上的起伏 */}
          <circle cx="20" cy="26" r="9" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="44" cy="27" r="8.5" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="31" cy="14.5" r="8.5" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="41" cy="38" r="8" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="22" cy="38" r="8.5" fill="#3F6A2A" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* 主冠 */}
          <circle cx="32" cy="27" r="14.5" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* 背光側的一塊暗面，讓球讀得出體積（模型也只有一塊 OUT_LEAF_DARK） */}
          <path d="M22.5 38.2C19.6 35.5 18.2 31.4 18.6 27.4C23.6 30.6 27.6 34.8 29.4 39.9C26.9 40.6 24.4 40 22.5 38.2Z" fill="#4A8F2E" />
        </svg>
      );
    case 'deco-shrub-flowering':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <circle cx="32" cy="40" r="17" fill="#3F6A2A" stroke={strokeColor} strokeWidth={strokeWidth} />
          {[[20, 30], [44, 32], [32, 22], [22, 46], [42, 48]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3.4" fill={i % 2 === 0 ? '#E07FA3' : '#F5C542'} stroke={strokeColor} strokeWidth="0.8" />
          ))}
        </svg>
      );
    case 'deco-shrub-tropical':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 52C32 52 12 46 10 34M32 52C32 52 14 32 18 18M32 52C32 52 30 30 32 14M32 52C32 52 34 30 46 18M32 52C32 52 52 32 54 34" stroke="#4A8F2E" strokeWidth="5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'deco-shrub-wild':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <circle cx="26" cy="42" r="13" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="42" cy="36" r="10" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="38" cy="48" r="8" fill="#3F6A2A" stroke={strokeColor} strokeWidth={strokeWidth} />
        </svg>
      );
    case 'deco-flower-cluster':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M20 56V32M32 56V22M44 56V30M14 56V40M50 56V38" stroke="#3F6A2A" strokeWidth="3" strokeLinecap="round" />
          {[[20, 32, '#E0503F'], [32, 22, '#F5C542'], [44, 30, '#F4A6C1'], [14, 40, '#9B6FC9'], [50, 38, '#E0503F']].map(([x, y, c], i) => (
            <circle key={i} cx={x as number} cy={y as number} r="5" fill={c as string} stroke={strokeColor} strokeWidth="1" />
          ))}
        </svg>
      );
    case 'deco-flower-single':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V28" stroke="#3F6A2A" strokeWidth="4" strokeLinecap="round" />
          <path d="M32 40L22 46M32 40L42 46" stroke="#4A8F2E" strokeWidth="3" strokeLinecap="round" />
          {[0, 60, 120, 180, 240, 300].map((a, i) => (
            <ellipse key={i} cx={32 + Math.cos((a * Math.PI) / 180) * 10} cy={20 + Math.sin((a * Math.PI) / 180) * 10} rx="7" ry="4.5" fill="#E0503F" stroke={strokeColor} strokeWidth="1" transform={`rotate(${a} ${32 + Math.cos((a * Math.PI) / 180) * 10} ${20 + Math.sin((a * Math.PI) / 180) * 10})`} />
          ))}
          <circle cx="32" cy="20" r="5.5" fill="#F5C542" stroke={strokeColor} strokeWidth="1" />
        </svg>
      );
    case 'deco-flower-tropical':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M24 56C20 40 20 28 28 20M40 56C44 40 44 28 36 20" stroke="#4A8F2E" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M32 34L20 16L32 20Z" fill="#9B6FC9" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M30 30L24 10L34 18Z" fill="#E2762F" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M34 30L40 8L38 20Z" fill="#F5C542" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'deco-flower-carpet':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="32" cy="40" rx="26" ry="14" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          {[[18, 36, '#E0503F'], [28, 44, '#F5C542'], [38, 34, '#F4A6C1'], [46, 42, '#9B6FC9'], [24, 30, '#F5C542'], [42, 30, '#E0503F']].map(([x, y, c], i) => (
            <circle key={i} cx={x as number} cy={y as number} r="3.2" fill={c as string} />
          ))}
        </svg>
      );
    case 'deco-grass-tuft':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56C32 56 22 40 26 22M32 56C32 56 30 36 32 16M32 56C32 56 42 40 38 22M32 56C32 56 16 44 14 32M32 56C32 56 48 44 50 32" stroke="#4A8F2E" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'deco-fern':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {[[-30, '#3F6A2A'], [0, '#4A8F2E'], [30, '#3F6A2A']].map(([rot, c], i) => (
            <g key={i} transform={`rotate(${rot} 32 56)`}>
              <path d="M32 56V20" stroke={c as string} strokeWidth="2.5" />
              {[26, 34, 42].map((y, j) => (
                <path key={j} d={`M32 ${y}L24 ${y - 4}M32 ${y}L40 ${y - 4}`} stroke={c as string} strokeWidth="2" strokeLinecap="round" />
              ))}
            </g>
          ))}
        </svg>
      );
    case 'deco-leaf-plant':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V44" stroke="#3F6A2A" strokeWidth="3" strokeLinecap="round" />
          <path d="M20 44C20 30 32 28 32 44C32 28 44 30 44 44" stroke="#4A8F2E" strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse cx="20" cy="38" rx="9" ry="7" fill="#6CB33F" stroke={strokeColor} strokeWidth="1.2" transform="rotate(-20 20 38)" />
          <ellipse cx="44" cy="38" rx="9" ry="7" fill="#4A8F2E" stroke={strokeColor} strokeWidth="1.2" transform="rotate(20 44 38)" />
        </svg>
      );
    case 'deco-groundcover-wild':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M20 56C20 56 16 44 20 34M32 56V26M44 56C44 56 48 46 42 36" stroke="#4A8F2E" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="20" cy="52" r="2.6" fill="#F5C542" />
        </svg>
      );
    case 'deco-tropical-leaf-large':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 56V30M20 56V26M44 56V26" stroke="#3F6A2A" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="32" cy="18" rx="12" ry="18" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="16" cy="20" rx="8" ry="13" fill="#6CB33F" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(-18 16 20)" />
          <ellipse cx="48" cy="20" rx="8" ry="13" fill="#3F6A2A" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(18 48 20)" />
        </svg>
      );
    case 'deco-mushroom-cluster':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="27" y="38" width="6" height="16" rx="2" fill="#F1E6D2" stroke={strokeColor} strokeWidth="1.5" />
          <ellipse cx="30" cy="36" rx="14" ry="9" fill="#C4503F" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="24" cy="33" r="2" fill="#FDF6F0" />
          <circle cx="34" cy="35" r="2" fill="#FDF6F0" />
          <rect x="42" y="44" width="4" height="10" rx="1.5" fill="#F1E6D2" stroke={strokeColor} strokeWidth="1" />
          <ellipse cx="44" cy="42" rx="8" ry="5.5" fill="#E0503F" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );
    case 'deco-cactus':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="26" y="52" width="12" height="6" rx="2" fill="#94A3B8" />
          <rect x="26" y="18" width="12" height="38" rx="6" fill="#3F6A2A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M18 38C18 30 26 30 26 30V44C26 44 18 46 18 38Z" fill="#3F6A2A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M46 30C46 22 38 22 38 22V36C38 36 46 38 46 30Z" fill="#4A8F2E" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M28 24V52M32 20V56M36 24V52" stroke="#6CB33F" strokeWidth="1" />
        </svg>
      );
    case 'deco-vine-trellis':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M14 58V16M50 58V16" stroke="#7A5228" strokeWidth="4" strokeLinecap="round" />
          <path d="M14 16C14 8 50 8 50 16" stroke="#7A5228" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M22 20C22 30 20 42 24 54M32 18V50M42 20C42 30 44 42 40 54" stroke="#3F6A2A" strokeWidth="2.5" fill="none" />
          {[[24, 34], [32, 30], [40, 40], [24, 46], [40, 48]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3.2" fill="#4A8F2E" />
          ))}
        </svg>
      );
    case 'deco-water-lily-planter':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="32" cy="44" rx="22" ry="9" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="41" rx="18" ry="7" fill="#38BDF8" stroke={strokeColor} strokeWidth="2" />
          <ellipse cx="22" cy="40" rx="8" ry="4.5" fill="#4A8F2E" stroke={strokeColor} strokeWidth="1.2" />
          <ellipse cx="38" cy="43" rx="6" ry="3.5" fill="#3F6A2A" stroke={strokeColor} strokeWidth="1.2" />
          <circle cx="30" cy="36" r="5" fill="#FDF6F0" stroke={strokeColor} strokeWidth="1.2" />
          <circle cx="30" cy="36" r="2" fill="#F5C542" />
        </svg>
      );

    case 'deco-fence-picket':
      // Three pickets, not the model's seven. At 32px a faithful count closes the gaps to a
      // pixel each, the rails behind them disappear, and the card reads as a row of pointed
      // sticks — so the picture keeps the fence's PARTS (capped end posts, two rails, pointed
      // pickets) and spends the width on showing the rails between them.
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* The two rails. Deliberately UNOUTLINED: they are only ever seen through 4px gaps,
              and a 2px stroke on each edge of a 7px bar leaves those gaps solid black at card size.
              A warm unstroked fill reads as the wood behind instead. */}
          <rect x="8" y="29" width="48" height="7" rx="2" fill="#C9A87A" />
          <rect x="8" y="41" width="48" height="7" rx="2" fill="#C9A87A" />
          {/* Pointed pickets, in front of the rails */}
          <path d="M17 55V26L20.5 19L24 26V55Z" fill="#FDFBF6" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M28.5 55V26L32 19L35.5 26V55Z" fill="#FDFBF6" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M40 55V26L43.5 19L47 26V55Z" fill="#FDFBF6" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          {/* End posts, each under a pyramid cap — the rails run in behind them */}
          <rect x="4" y="22" width="9" height="33" rx="1.5" fill="#F6F1E7" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M2 22L8.5 13L15 22H2Z" fill="#C2AE91" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="51" y="22" width="9" height="33" rx="1.5" fill="#F6F1E7" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M49 22L55.5 13L62 22H49Z" fill="#C2AE91" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Two blades of grass at the foot. Straight and thin — curved at 2.5 they read as
              green hooks hanging off the fence rather than as grass in front of it. */}
          <path d="M15.5 56.5L17.5 50M48.5 56.5L46.5 50" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    // ---- WALL LUXURY MOUNTABLE DECORATIONS (Paint can, Picture frame, Floating shelf, Sconce lamp, Landscape window) ----
    case 'deco-wall-paint-can':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Metal cylinder bucket */}
          <rect x="18" y="24" width="28" height="26" rx="4" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Splash of pink colors labeled */}
          <rect x="18" y="32" width="28" height="10" fill="#EC4899" />
          <circle cx="32" cy="37" r="3" fill="#FFF" />
          {/* Wire handle standing up */}
          <path d="M18 24C18 12 46 12 46 24" stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* Stir brush wood handle sticking out */}
          <path d="M36 28L44 12" stroke="#B45309" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'deco-wall-painting':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Cute picture frame hanger thread */}
          <path d="M32 8L16 20H48L32 8Z" stroke={strokeColor} strokeWidth="2" fill="none" strokeLinejoin="round" />
          <circle cx="32" cy="8" r="2" fill="#D97706" />
          {/* Wood frame */}
          <rect x="12" y="20" width="40" height="32" rx="4" fill="#8B5A2B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Inside art canvas showing a cute setting sun */}
          <rect x="16" y="24" width="32" height="24" rx="2" fill="#BAE6FD" stroke={strokeColor} strokeWidth="2" />
          <circle cx="24" cy="32" r="5" fill="#EF4444" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M16 44L28 36L48 44H16Z" fill="#FCD34D" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'deco-wall-shelf':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Floating wood board */}
          <rect x="10" y="34" width="44" height="6" rx="2" fill="#C68E5A" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Little green trailing vine potted plant */}
          <rect x="16" y="22" width="10" height="12" rx="2" fill="#FFF" stroke={strokeColor} strokeWidth="2" />
          <path d="M21 22C21 22 18 12 14 14C10 16 12 24 16 26" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <path d="M21 22C21 22 25 10 29 12C33 14 28 24 24 26" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" fill="none" />
          {/* Books leaning on shelf */}
          <rect x="34" y="20" width="4" height="14" fill="#3B82F6" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="39" y="22" width="4" height="12" fill="#EF4444" stroke={strokeColor} strokeWidth="1.5" transform="rotate(15 39 22)" />
        </svg>
      );
    case 'deco-wall-lamp':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="warmSconce" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFF" stopOpacity="0" />
              <stop offset="100%" stopColor="#FEF08A" stopOpacity="0.8" />
            </linearGradient>
          </defs>
          {/* Wall plate connector */}
          <rect x="16" y="26" width="6" height="12" rx="2" fill="#64748B" stroke={strokeColor} strokeWidth="2" />
          {/* Sconce gooseneck arm */}
          <path d="M22 32H34V20" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" fill="none" />
          {/* Golden bell shade pointing downwards */}
          <path d="M26 20C26 20 28 10 34 10C40 10 42 20 42 20H26Z" fill="#FBBF24" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Light bulb glowing */}
          <circle cx="34" cy="23" r="3" fill="#FEF08A" />
          {/* Warm cone of light casting downwards */}
          <path d="M34 24L14 56H54L34 24Z" fill="url(#warmSconce)" opacity="0.65" pointerEvents="none" />
        </svg>
      );
    case 'deco-wall-window':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Wooden window arch frame */}
          <path d="M14 48V28C14 18 22 12 32 12C42 12 50 18 50 28V48H14Z" fill="#C68E5A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Window pane showing sky and small cloud */}
          <path d="M18 45V28C18 20 24 16 32 16C40 16 46 20 46 28V45H18Z" fill="#E0F2FE" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          {/* Grid cross bars */}
          <line x1="32" y1="16" x2="32" y2="45" stroke={strokeColor} strokeWidth="2" />
          <line x1="18" y1="32" x2="46" y2="32" stroke={strokeColor} strokeWidth="2" />
          {/* Cute white cloud inside window */}
          <path d="M36 28C36 26 38 25 40 25C42 25 43 27 43 28C44 28 45 29 45 30C45 31 44 32 43 32H36V28Z" fill="#FFF" />
          {/* Little potted flower plant on window sill */}
          <rect x="28" y="42" width="8" height="6" fill="#F97316" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="32" cy="38" r="2.5" fill="#EF4444" />
        </svg>
      );
    case 'deco-wall-table':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="consoleWood" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#CD853F" />
              <stop offset="100%" stopColor="#8B4513" />
            </linearGradient>
            <linearGradient id="plantPotGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFA07A" />
              <stop offset="100%" stopColor="#E9967A" />
            </linearGradient>
          </defs>
          {/* Elegant Curved Legs */}
          <path d="M16 38C16 48 18 56 18 56" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M48 38C48 48 46 56 46 56" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M24 38C24 45 26 50 26 50" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M40 38C40 45 38 50 38 50" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />

          {/* Table Main Console Drawer Body */}
          <rect x="10" y="26" width="44" height="12" rx="4" fill="url(#consoleWood)" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Drawer dividing lines and panels */}
          <rect x="14" y="29" width="16" height="6" rx="2" fill="#A0522D" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="34" y="29" width="16" height="6" rx="2" fill="#A0522D" stroke={strokeColor} strokeWidth="1.5" />
          {/* Tiny gold knobs */}
          <circle cx="22" cy="32" r="1.5" fill="#FBBF24" stroke={strokeColor} strokeWidth="1" />
          <circle cx="42" cy="32" r="1.5" fill="#FBBF24" stroke={strokeColor} strokeWidth="1" />

          {/* Small Potted Plant on top of table */}
          <rect x="28" y="21" width="8" height="5" rx="1.5" fill="url(#plantPotGrad)" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M30 21C28 17 26 15 24 16C22 17 25 21 30 21Z" fill="#4ADE80" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M34 21C36 17 38 15 40 16C42 17 39 21 34 21Z" fill="#4ADE80" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M32 21C32 15 32 12 30 12C28 12 29 18 32 21Z" fill="#22C55E" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );

    // ---- 寵物用品 (constants/consumables.ts, constants/petCare.ts) ----

    // 基礎飼料 — an open sack with kibble spilling out of it, and a full bowl beside it.
    //
    // The BOWL is the half that carries the meaning. A sack alone at chip size is a bag of
    // anything — flour, sand, seed — and what a player needs to recognise here is 「這是餵寵物的」.
    // The kibble is drawn as three loose pellets rather than as a texture: at 64px a stipple fill
    // reads as noise, while three shapes read as pieces of food.
    case 'petfood-basic':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="petFoodSack" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#D9BE93" />
              <stop offset="100%" stopColor="#B99765" />
            </linearGradient>
          </defs>
          {/* Sack body, widening toward the base so it reads as a sack standing on the ground
              rather than as a box. */}
          <path
            d="M29 27L48 27L51 50C51 53 49 55 46 55L32 55C29 55 27 53 27 50Z"
            fill="url(#petFoodSack)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          {/* The rolled-down top: a band wider than the body, which is the one detail that says
              'sack' rather than 'bag of anything'. */}
          <path d="M26 18L51 18L48 27L29 27Z" fill="#C9A876" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M28.5 22.5L48.5 22.5" stroke="#8A6A3E" strokeWidth="1.5" strokeLinecap="round" />
          {/* Paw mark on the front — the label, and the thing that says 'pet' at chip size. */}
          <circle cx="39" cy="45" r="3.6" fill="#8A6A3E" />
          <circle cx="34.8" cy="40.6" r="1.5" fill="#8A6A3E" />
          <circle cx="39" cy="39.2" r="1.5" fill="#8A6A3E" />
          <circle cx="43.2" cy="40.6" r="1.5" fill="#8A6A3E" />
          {/* The bowl, clear of the sack. Island teal, the same colour the bowl is in 3D
              (Three/FurnitureItem.tsx's PetBedModel and the improvised nest), so the two read as
              the same object. */}
          <path d="M4 45L22 45C22 52 18.5 56 13 56C7.5 56 4 52 4 45Z" fill="#5FBDAF" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="13" cy="45" rx="9" ry="2.6" fill="#1F7A70" stroke={strokeColor} strokeWidth="1.5" />
          {/* Kibble. Three loose shapes rather than a stipple fill: at 64px a texture reads as
              noise, while three shapes read as pieces of food. */}
          <circle cx="9.6" cy="44.4" r="2.2" fill="#B4762F" stroke={strokeColor} strokeWidth="1.2" />
          <circle cx="16.4" cy="44.2" r="2" fill="#C98B4E" stroke={strokeColor} strokeWidth="1.2" />
          <circle cx="13" cy="41.6" r="2.1" fill="#B4762F" stroke={strokeColor} strokeWidth="1.2" />
        </svg>
      );

    // 戶外寵物窩 — the same basket the 3D model builds (Three/FurnitureItem.tsx's PetBedModel),
    // drawn from the front three-quarters: woven rim, cream cushion, teal bowl. Same palette in
    // both places on purpose, for the reason constants/pets.ts gives about the animals themselves —
    // a card and the thing you get should not be two different objects.
    case 'petbed-outdoor-basic':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="petBedWeave" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#D3A96F" />
              <stop offset="100%" stopColor="#A97C48" />
            </linearGradient>
          </defs>
          {/* Basket wall. */}
          <path d="M8 36C8 36 10 50 12 52C14 54 42 54 44 52C46 50 48 36 48 36Z" fill="url(#petBedWeave)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Weave lines — two is enough to say 'woven' and few enough to survive the shrink. */}
          <path d="M10.5 42C18 44 38 44 45.5 42" stroke="#8A6A3E" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <path d="M11.8 47C19 49 37 49 44.2 47" stroke="#8A6A3E" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          {/* The cushion, sitting INSIDE the rim. */}
          <ellipse cx="28" cy="35" rx="17" ry="7" fill="#E8DDC8" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="28" cy="34.4" rx="9" ry="3.4" fill="none" stroke="#CFC0A4" strokeWidth="1.5" />
          {/* The rim itself, drawn over the cushion so the cushion is tucked under it. */}
          <ellipse cx="28" cy="36" rx="20" ry="8" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* The bowl beside it. */}
          <path d="M46 45L62 45C62 51 58.5 54.5 54 54.5C49.5 54.5 46 51 46 45Z" fill="#5FBDAF" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="54" cy="45" rx="8" ry="2.4" fill="#1F7A70" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );

    // ---- 寵物飼料，一種一件 (constants/items.ts 的 consumable.species) ----
    //
    // Six of the seven below are FOR one species, and the icon's job is to say which without a
    // label: the food's own container carries it (a stew can, an oval sardine tin, a seed sack) and
    // the species' own signature sits beside it (a bone, a fish tail, a feather). A row of
    // recoloured bowls would have made the species filter look like an arbitrary restriction rather
    // than an obvious one.
    //
    // 島嶼手作點心 is the exception and is drawn as exactly that — three different shapes on a leaf,
    // with no animal signature at all, because what it means is 「誰都吃得到」.

    // 燉肉罐頭 — a squat can with the lid peeled back and a bone leaning on it.
    case 'petfood-dog-stew':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="dogStewCan" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#C9714C" />
              <stop offset="55%" stopColor="#E08A61" />
              <stop offset="100%" stopColor="#B45F3D" />
            </linearGradient>
          </defs>
          {/* Can body. */}
          <path d="M16 26L48 26L48 50C48 53 45 55 32 55C19 55 16 53 16 50Z" fill="url(#dogStewCan)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Label band, the one flat area on the can — it is what stops the gradient reading as a
              cylinder of jam. */}
          <path d="M16 34L48 34L48 43L16 43Z" fill="#F2E2C4" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="26" cy="38.5" r="2.6" fill="#8A6A3E" />
          <circle cx="23" cy="35.4" r="1.1" fill="#8A6A3E" />
          <circle cx="26" cy="34.6" r="1.1" fill="#8A6A3E" />
          <circle cx="29" cy="35.4" r="1.1" fill="#8A6A3E" />
          <path d="M34 38.5L42 38.5" stroke="#8A6A3E" strokeWidth="2" strokeLinecap="round" />
          {/* Stew showing over the rim. */}
          <ellipse cx="32" cy="26" rx="16" ry="5" fill="#8A4B2A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="28" cy="25" rx="4" ry="2" fill="#D9903F" />
          <ellipse cx="37" cy="26.5" rx="3" ry="1.6" fill="#C97A34" />
          {/* The peeled lid — the detail that says 「開了」 rather than 「一個罐子」. */}
          <path d="M44 24C50 20 52 14 49 11C46 15 45 20 44 24Z" fill="#E4E4E4" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          {/* A bone leaning against it: 狗 in one shape. */}
          <g transform="rotate(-24 13 46)">
            <rect x="5" y="43" width="17" height="6" rx="3" fill="#F5EBDA" stroke={strokeColor} strokeWidth="1.8" />
            <circle cx="6" cy="43.5" r="3" fill="#F5EBDA" stroke={strokeColor} strokeWidth="1.8" />
            <circle cx="6" cy="48.5" r="3" fill="#F5EBDA" stroke={strokeColor} strokeWidth="1.8" />
            <circle cx="21" cy="43.5" r="3" fill="#F5EBDA" stroke={strokeColor} strokeWidth="1.8" />
            <circle cx="21" cy="48.5" r="3" fill="#F5EBDA" stroke={strokeColor} strokeWidth="1.8" />
          </g>
        </svg>
      );

    // 手撕肉乾條 — a paper bag with three strips standing out of it.
    case 'petfood-dog-jerky':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* The strips. Drawn FIRST so the bag overlaps them and they read as inside it. */}
          {[
            { x: 22, r: -12 },
            { x: 31, r: 2 },
            { x: 40, r: 14 },
          ].map((s) => (
            <g key={s.x} transform={`rotate(${s.r} ${s.x} 30)`}>
              <rect x={s.x - 4} y="12" width="8" height="26" rx="3" fill="#B4623A" stroke={strokeColor} strokeWidth="1.8" />
              <path d={`M${s.x} 16L${s.x} 34`} stroke="#8A4526" strokeWidth="1.4" strokeLinecap="round" />
            </g>
          ))}
          {/* The kraft bag, its top edge torn. */}
          <path
            d="M14 32L50 32L47 55C47 57 45 58 43 58L21 58C19 58 17 57 17 55Z"
            fill="#D9BE93" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          <path d="M14 32L18 29L22 32L26 29L30 32L34 29L38 32L42 29L46 32L50 32" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" fill="none" />
          {/* Fold shadow down one side, so the bag has a front and a side. */}
          <path d="M40 34L38 56" stroke="#B99765" strokeWidth="2" strokeLinecap="round" />
          {/* Paw label. */}
          <circle cx="27" cy="47" r="3.2" fill="#8A6A3E" />
          <circle cx="23.4" cy="43.2" r="1.3" fill="#8A6A3E" />
          <circle cx="27" cy="42" r="1.3" fill="#8A6A3E" />
          <circle cx="30.6" cy="43.2" r="1.3" fill="#8A6A3E" />
        </svg>
      );

    // 油漬鯖魚罐 — the flat oval tin, opened, with a fish tail rising out of the oil.
    case 'petfood-cat-sardine':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <defs>
            <linearGradient id="catTinBody" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#9FB6C4" />
              <stop offset="100%" stopColor="#77909F" />
            </linearGradient>
          </defs>
          {/* The rolled-back lid on its key — the sardine tin's whole silhouette. */}
          <path d="M42 22C51 17 55 10 51 6C46 10 44 16 42 22Z" fill="#DDE4E8" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          {/* Tin body: an oval, not a circle. A round tin is a can of dog food. */}
          <path d="M6 34C6 29 17 26 32 26C47 26 58 29 58 34L58 42C58 48 47 52 32 52C17 52 6 48 6 42Z" fill="url(#catTinBody)" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="32" cy="34" rx="26" ry="8" fill="#D9A83E" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Oil highlight. */}
          <ellipse cx="24" cy="33" rx="7" ry="2.4" fill="#EFC868" />
          {/* Two fish backs lying in it. */}
          <path d="M14 34C20 30 28 30 34 34C28 37 20 37 14 34Z" fill="#5D7686" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M30 35C36 31 44 31 50 35C44 38 36 38 30 35Z" fill="#6E8797" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
          {/* One tail out of the tin, which is what makes it 魚 rather than 灰色的東西. */}
          <path d="M46 30L54 22L56 30L54 33Z" fill="#8FA6B4" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );

    // 貓薄荷脆餅 — star biscuits with mint leaves, on a saucer.
    case 'petfood-cat-crunch':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Saucer. */}
          <path d="M6 42L58 42C58 50 47 55 32 55C17 55 6 50 6 42Z" fill="#EDE3D2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="32" cy="42" rx="26" ry="6" fill="#FBF5E9" stroke={strokeColor} strokeWidth="1.6" />
          {/* Three stars. Drawn as one path each, at three sizes — an identical trio reads as a
              pattern rather than as a handful. */}
          {[
            { cx: 21, cy: 34, r: 9 },
            { cx: 35, cy: 28, r: 11 },
            { cx: 45, cy: 37, r: 8 },
          ].map((s) => (
            <path
              key={s.cx}
              d={Array.from({ length: 10 }, (_, i) => {
                const a = (Math.PI / 5) * i - Math.PI / 2;
                const rr = i % 2 === 0 ? s.r : s.r * 0.46;
                return `${i === 0 ? 'M' : 'L'}${(s.cx + Math.cos(a) * rr).toFixed(1)} ${(s.cy + Math.sin(a) * rr).toFixed(1)}`;
              }).join('') + 'Z'}
              fill="#D8A857" stroke={strokeColor} strokeWidth="1.9" strokeLinejoin="round"
            />
          ))}
          {/* The mint — two leaves, which is the only thing separating this from a plain biscuit. */}
          <path d="M50 18C44 18 41 22 42 27C48 27 51 23 50 18Z" fill="#7FA361" stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M56 24C51 22 47 25 47 30C52 31 56 29 56 24Z" fill="#95B876" stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );

    // 綜合穀物種子 — a drawstring sack with a millet spray and loose seeds.
    case 'petfood-bird-seed':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* The millet spray, behind the sack. */}
          <path d="M44 8C50 14 52 22 50 30" stroke="#B8A05C" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          {[
            [43, 12], [47, 15], [49, 20], [50, 25], [41, 16], [45, 21], [47, 26],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#E3C96E" stroke={strokeColor} strokeWidth="1.3" />
          ))}
          {/* Sack, gathered at the neck by a cord — a shape a rigid box cannot make. */}
          <path
            d="M15 30C15 30 12 40 13 48C14 54 18 57 28 57C38 57 42 54 43 48C44 40 41 30 41 30Z"
            fill="#DCCBA6" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
          <path d="M15 30C15 26 20 24 28 24C36 24 41 26 41 30C41 33 36 34 28 34C20 34 15 33 15 30Z" fill="#C6B183" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* The cord and its two ends. */}
          <path d="M16 31L40 31" stroke="#8A6A3E" strokeWidth="2" strokeLinecap="round" />
          <path d="M40 31C44 32 45 35 43 37" stroke="#8A6A3E" strokeWidth="2" strokeLinecap="round" fill="none" />
          {/* Loose seeds on the ground — three shapes, never a stipple (see 基礎飼料). */}
          <ellipse cx="9" cy="53" rx="3" ry="2.2" transform="rotate(-20 9 53)" fill="#E3C96E" stroke={strokeColor} strokeWidth="1.3" />
          <ellipse cx="50" cy="52" rx="3" ry="2.2" transform="rotate(15 50 52)" fill="#C9A94E" stroke={strokeColor} strokeWidth="1.3" />
          <ellipse cx="55" cy="46" rx="2.6" ry="2" transform="rotate(-35 55 46)" fill="#E3C96E" stroke={strokeColor} strokeWidth="1.3" />
        </svg>
      );

    // 果乾小點 — translucent mango and papaya slices in a small dish, with a feather beside them.
    case 'petfood-bird-fruit':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* The feather — 鳥 stated in one shape, the way the bone states 狗 above. */}
          <g transform="rotate(28 52 26)">
            <path d="M52 8C57 14 57 26 52 34C47 26 47 14 52 8Z" fill="#9CC6D8" stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M52 10L52 33" stroke="#5E8497" strokeWidth="1.4" strokeLinecap="round" />
          </g>
          {/* Dish. */}
          <path d="M6 38L46 38C46 48 37 54 26 54C15 54 6 48 6 38Z" fill="#EDE3D2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="26" cy="38" rx="20" ry="5.5" fill="#FBF5E9" stroke={strokeColor} strokeWidth="1.6" />
          {/* Curled slices. The CURL is the whole idea of a dried fruit — flat discs would be
              lemon. */}
          <path d="M12 36C12 26 20 22 26 26C22 28 20 32 21 36Z" fill="#F0A63F" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M24 37C25 28 33 24 39 28C34 30 32 33 33 37Z" fill="#EE8B58" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M34 38C36 32 41 30 44 33C41 34 39 36 39 38Z" fill="#F5BE6A" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );

    // 島嶼手作點心 — three different shapes on a leaf. No animal signature anywhere on it, which is
    // the point: this is the one food that is not FOR anybody in particular.
    case 'petfood-treat-island':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* The leaf it is served on — 島嶼手作 in one shape, and the reason this reads as made
              rather than bought. */}
          <path d="M4 44C10 30 26 22 44 24C50 24 56 26 60 30C52 44 34 52 18 50C12 49 7 47 4 44Z" fill="#8FB56E" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M6 44C18 38 34 32 58 30" stroke="#5F8449" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          {/* A flower, a heart and a round one — three shapes, so 「誰都吃得到」 is legible before
              any text is read. */}
          <g>
            {Array.from({ length: 5 }, (_, i) => {
              const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
              return <circle key={i} cx={20 + Math.cos(a) * 5.4} cy={38 + Math.sin(a) * 5.4} r="4" fill="#E9C36A" stroke={strokeColor} strokeWidth="1.6" />;
            })}
            <circle cx="20" cy="38" r="3.2" fill="#D89A3C" stroke={strokeColor} strokeWidth="1.4" />
          </g>
          <path d="M36 32C36 28 42 27 43 31C44 27 50 28 50 32C50 36 43 41 43 41C43 41 36 36 36 32Z" fill="#E39A86" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="32" cy="44" r="5.4" fill="#D8A857" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="30.4" cy="42.4" r="1.5" fill="#F0D6A0" />
        </svg>
      );

    // ---- 寵物休息處 (constants/petHabitats.ts) ----
    //
    // Nine homes across three species, drawn to the same rule the 3D models follow
    // (Three/FurnitureItem.tsx's 寵物休息處 block): warm pine, willow, cream canvas, and island
    // teal for every bowl. A card and the object placed on the island should be recognisably the
    // same thing — the rule constants/pets.ts states for the animals themselves.

    // 木製小狗屋 — gable, arched door, name plaque.
    case 'pethome-dog-cabin':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M10 30L54 30L54 54L10 54Z" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M14 38L50 38M14 46L50 46" stroke="#98673A" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M6 32L32 10L58 32Z" fill="#98673A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Arched doorway, and the straw inside it. */}
          <path d="M23 54L23 42C23 37 41 37 41 42L41 54Z" fill="#3A2A1C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M24 54L40 54C40 51 36 49 32 49C28 49 24 51 24 54Z" fill="#DBBE7C" />
          {/* Plaque, blank — it is the player's dog. */}
          <rect x="24" y="31" width="16" height="6" rx="2" fill="#E8CF9C" stroke={strokeColor} strokeWidth="1.6" />
        </svg>
      );

    // 帆布帳篷窩 — A-frame canvas, flaps tied back, ridge pole showing.
    case 'pethome-dog-tent':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 8L58 54L6 54Z" fill="#EFE4CE" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* The dark opening. */}
          <path d="M32 22L44 54L20 54Z" fill="#3A2A1C" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          {/* Flaps, pulled aside and tied. */}
          <path d="M32 22L20 54L12 54L26 20Z" fill="#E2D2B4" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M32 22L44 54L52 54L38 20Z" fill="#D8C7A6" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="20" cy="38" r="2.6" fill="#B08A5A" stroke={strokeColor} strokeWidth="1.4" />
          <circle cx="44" cy="38" r="2.6" fill="#B08A5A" stroke={strokeColor} strokeWidth="1.4" />
          {/* Ridge pole out of the top. */}
          <path d="M32 12L32 4" stroke="#98673A" strokeWidth="3" strokeLinecap="round" />
          {/* The mat inside. */}
          <ellipse cx="32" cy="51" rx="8" ry="2.6" fill="#C9BFA6" />
        </svg>
      );

    // 藤編狗籃 — long oval willow basket, checked blanket.
    case 'pethome-dog-basket':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M4 32C4 32 6 48 9 51C12 54 52 54 55 51C58 48 60 32 60 32Z" fill="#C7A472" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M7 39C20 42 44 42 57 39M8.5 45C21 48 43 48 55.5 45" stroke="#98673A" strokeWidth="1.7" strokeLinecap="round" fill="none" />
          {/* Blanket, tucked under the rim. */}
          <ellipse cx="32" cy="31" rx="24" ry="7" fill="#D9D2C4" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M24 25.5L24 36M40 25.5L40 36" stroke="#B9AE99" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M10 31L54 31" stroke="#B9AE99" strokeWidth="1.8" strokeLinecap="round" />
          {/* Rim over the top, so the blanket sits inside. */}
          <ellipse cx="32" cy="32" rx="28" ry="8.5" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
        </svg>
      );

    // 圓形貓窩 — fat cream rim, dished middle.
    case 'pethome-cat-donut':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="32" cy="38" rx="28" ry="17" fill="#E8DDC8" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="38" rx="15" ry="8" fill="#D6C8AE" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* The quilted seam. */}
          <ellipse cx="32" cy="36.5" rx="22" ry="12" fill="none" stroke="#C6B69A" strokeWidth="1.7" />
          {/* Four stitch ticks, which is what makes the rim read as padded rather than as a tyre. */}
          {[0, 1, 2, 3].map((i) => {
            const a = (Math.PI / 2) * i + Math.PI / 4;
            return (
              <path
                key={i}
                d={`M${32 + Math.cos(a) * 17} ${38 + Math.sin(a) * 10}L${32 + Math.cos(a) * 25} ${38 + Math.sin(a) * 15}`}
                stroke="#C6B69A" strokeWidth="1.7" strokeLinecap="round"
              />
            );
          })}
        </svg>
      );

    // 毛線貓屋 — coiled dome, round door, loose ball on top.
    case 'pethome-cat-yarn':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M6 52C6 32 18 18 32 18C46 18 58 32 58 52Z" fill="#D8B9A8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* The coils. */}
          <path d="M8 44C20 40 44 40 56 44" stroke="#C79E8A" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M11 35C21 30 43 30 53 35" stroke="#C79E8A" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M18 26C24 22 40 22 46 26" stroke="#C79E8A" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          {/* Base line, so the dome sits on something. */}
          <path d="M6 52L58 52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
          {/* The door. */}
          <path d="M22 52L22 44C22 38 42 38 42 44L42 52Z" fill="#3A2A1C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* The yarn ball and its loose end. */}
          <circle cx="46" cy="14" r="8" fill="#B9857A" stroke={strokeColor} strokeWidth="1.9" />
          <path d="M41 10C45 13 47 16 50 19M43 19C45 15 48 12 51 11" stroke="#8F6259" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <path d="M39 18C34 20 32 22 31 25" stroke="#B9857A" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      );

    // 木製貓跳台 — cubby below, rope post, sunning platform on top.
    case 'pethome-cat-tower':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Platform. */}
          <ellipse cx="32" cy="16" rx="20" ry="7" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="14.5" rx="14" ry="4.4" fill="#E8DDC8" stroke="#98673A" strokeWidth="1.5" />
          {/* Post with its sisal wrap. */}
          <rect x="26" y="20" width="12" height="18" fill="#CDB58A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M26 24L38 24M26 29L38 29M26 34L38 34" stroke="#B69C71" strokeWidth="1.7" strokeLinecap="round" />
          {/* Cubby: box, roof, opening. */}
          <rect x="10" y="38" width="44" height="18" rx="2" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="7" y="34" width="50" height="6" rx="2" fill="#98673A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M22 56L22 46C22 42 42 42 42 46L42 56Z" fill="#3A2A1C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
        </svg>
      );

    // 木製鳥籠 — domed wooden cage on a foot, door open, perch across it.
    case 'pethome-bird-cage':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Hanging ring and dome. */}
          <circle cx="32" cy="7" r="4" fill="none" stroke={strokeColor} strokeWidth="2.2" />
          <path d="M12 26C12 16 21 11 32 11C43 11 52 16 52 26Z" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {/* Bars, with a gap at the front-left for the open door. */}
          {[16, 22, 28, 40, 46].map((x) => (
            <path key={x} d={`M${x} 26L${x} 46`} stroke="#C7A472" strokeWidth="2.6" strokeLinecap="round" />
          ))}
          <path d="M12 26L12 46M52 26L52 46" stroke="#C7A472" strokeWidth="2.6" strokeLinecap="round" />
          {/* The open door — a hinged panel swung out, which is what says 「門一直開著」. */}
          <path d="M31 26L31 46L23 50L23 30Z" fill="#D9BE93" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M26 30L26 46" stroke="#98673A" strokeWidth="1.5" strokeLinecap="round" />
          {/* Perch, and the two teal bowls on the tray. */}
          <path d="M13 36L51 36" stroke="#3D2A1C" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M8 46L56 46L56 51C56 53 54 54 52 54L12 54C10 54 8 53 8 51Z" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="21" cy="46" rx="5" ry="2.4" fill="#5FBDAF" stroke={strokeColor} strokeWidth="1.5" />
          <ellipse cx="43" cy="46" rx="5" ry="2.4" fill="#5FBDAF" stroke={strokeColor} strokeWidth="1.5" />
        </svg>
      );

    // 樹枝鳥架 — driftwood in a round base, one smooth fork, a leaf sprig.
    case 'pethome-bird-perch':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* Trunk, leaning. */}
          <path d="M28 52L33 16" stroke="#A87F53" strokeWidth="7" strokeLinecap="round" />
          {/* Bark rings. */}
          <path d="M27 44L34 43M28 36L35 35M29 28L36 27" stroke="#8E6941" strokeWidth="1.8" strokeLinecap="round" />
          {/* The fork the bird lands on — horizontal, and the widest line in the icon, because it
              is the part the object exists for. */}
          <path d="M14 20L52 16" stroke="#C29A6B" strokeWidth="6" strokeLinecap="round" />
          {/* Second twig. */}
          <path d="M31 30L16 34" stroke="#A87F53" strokeWidth="4" strokeLinecap="round" />
          {/* Leaf sprig. */}
          <path d="M50 16C56 14 58 10 56 7C51 8 49 12 50 16Z" fill="#7FA361" stroke={strokeColor} strokeWidth="1.7" strokeLinejoin="round" />
          {/* Base. */}
          <ellipse cx="30" cy="52" rx="20" ry="7" fill="#98673A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="30" cy="50" rx="20" ry="6" fill="#C08B52" stroke={strokeColor} strokeWidth={strokeWidth} />
        </svg>
      );

    // 手作鳥巢 — woven bowl cradled in a fork, cotton inside, straws sticking out.
    case 'pethome-bird-nest':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          {/* The fork holding it. */}
          <path d="M26 56L29 30M38 56L35 30" stroke="#A87F53" strokeWidth="5" strokeLinecap="round" />
          {/* Straws poking out of the weave, behind the bowl. */}
          <path d="M12 22L18 28M52 21L46 27M32 14L32 20" stroke="#DBBE7C" strokeWidth="2.4" strokeLinecap="round" />
          {/* The bowl. */}
          <path d="M8 26L56 26C56 26 52 44 48 47C44 50 20 50 16 47C12 44 8 26 8 26Z" fill="#C7A472" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M12 34C24 37 40 37 52 34M14.5 41C25 44 39 44 49.5 41" stroke="#B08F5F" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          {/* Cotton lining. */}
          <ellipse cx="32" cy="25" rx="19" ry="6.5" fill="#F3EADA" stroke={strokeColor} strokeWidth="1.8" />
          {/* Rim over it — deliberately not a smooth ellipse, so the weave reads as handmade. */}
          <path d="M4 26C4 20 16 17 32 17C48 17 60 20 60 26C60 31 48 33 32 33C16 33 4 31 4 26Z" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M5 24C14 20 26 19 32 19C40 19 52 20 59 24" stroke="#D0AC77" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </svg>
      );

    /* ==========================================================================================
     *                        2026-09 室內家具擴充 —— 每一件的商店預覽圖
     *
     * 一件商品一張圖，而且畫的是它 3D 模型真的長的樣子。這不是禮貌，是這次改動的重點：
     * `npm run audit:shop` 會把每一個 id 的圖畫出來，跟「不認得這個 id」的灰圈圈比對，也會比對
     * 彼此 —— 兩件不同的商品畫出同一張圖就是 FAIL。以前 熱帶木桌 與 橡木書桌、編織地毯 與
     * 波西米亞編織地毯、系統流理台 與 廚房吊櫃 各自共用一張圖，玩家在貨架上看到的是同一張照片
     * 標著兩個名字兩個價錢。
     *
     * 畫法沿用本檔既有的語言：64x64、暖棕描邊 (strokeColor)、平塗、不用漸層（漸層要 <defs> id，
     * 同一頁同時出現多張圖時 id 會互相蓋掉）。每張圖抓模型最能認出來的那一個特徵 —— 藤椅抓編縫、
     * 折疊桌抓 X 腳、梯形書架抓那個斜度 —— 而不是把模型縮小畫一遍。
     * ========================================================================================== */

    // ---- 客廳：坐的東西 ----

    // 藤編單人沙發 — the woven tub, its open front, and the cushion dropped in.
    case 'sofa-rattan-single':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M14 50V54M50 50V54M20 52V56M44 52V56" stroke="#A3773F" strokeWidth="3" strokeLinecap="round" />
          <path d="M12 24C12 18 20 15 32 15C44 15 52 18 52 24V44C52 50 44 53 32 53C20 53 12 50 12 44V24Z" fill="#CFA96B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M18 20V44M25 17V45M32 16V46M39 17V45M46 20V44" stroke="#A8834B" strokeWidth="1.8" />
          <path d="M12 26C20 30 44 30 52 26M12 40C20 44 44 44 52 40" stroke="#A8834B" strokeWidth="2.2" fill="none" />
          <path d="M16 38C16 34 22 32 32 32C42 32 48 34 48 38C48 42 42 44 32 44C22 44 16 42 16 38Z" fill="#EAE0CD" stroke={strokeColor} strokeWidth="2" />
          <rect x="22" y="20" width="20" height="13" rx="4" fill="#7FA8A0" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );

    // 亞麻雙人沙發 — low, two cushions with a visible seam, splayed pale legs, a throw.
    case 'sofa-linen-loveseat':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M12 46L8 56M52 46L56 56" stroke="#B98A52" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="10" y="18" width="44" height="18" rx="5" fill="#D4CABB" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="14" y="21" width="16" height="13" rx="3" fill="#EAE3D6" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="34" y="21" width="16" height="13" rx="3" fill="#EAE3D6" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="8" y="34" width="48" height="13" rx="4" fill="#DCD3C4" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M32 34V47" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="4" y="28" width="7" height="20" rx="3.5" fill="#C8BDAD" stroke={strokeColor} strokeWidth="2" />
          <rect x="53" y="28" width="7" height="20" rx="3.5" fill="#C8BDAD" stroke={strokeColor} strokeWidth="2" />
          <path d="M53 32C50 36 50 42 53 46" stroke="#8FA9A2" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );

    // L 型布沙發 — drawn from above-ish so the L itself is the picture.
    case 'sofa-l-shaped':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="6" y="14" width="46" height="10" rx="4" fill="#7D8A91" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="6" y="22" width="46" height="16" rx="4" fill="#8E9AA0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="36" y="30" width="22" height="20" rx="4" fill="#8E9AA0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="10" y="25" width="12" height="11" rx="2.5" fill="#A9B5BA" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="24" y="25" width="12" height="11" rx="2.5" fill="#A9B5BA" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="39" y="33" width="16" height="14" rx="3" fill="#A9B5BA" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="3" y="18" width="6" height="22" rx="3" fill="#7D8A91" stroke={strokeColor} strokeWidth="2" />
          <rect x="41" y="35" width="10" height="9" rx="2.5" fill="#D98F7A" stroke={strokeColor} strokeWidth="1.6" transform="rotate(-12 46 39)" />
          <path d="M9 44V50M50 50V56M20 38V44" stroke="#5B6469" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    // 棉麻懶骨頭 — a slumped blob with a seam round the middle and a handle at the back.
    case 'furn-beanbag':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M18 20C18 14 24 10 30 11C36 12 38 18 37 24" fill="#E3D5BF" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M6 40C6 30 17 24 32 24C47 24 58 30 58 40C58 49 47 54 32 54C17 54 6 49 6 40Z" fill="#D9C9B0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M7 39C16 43 48 43 57 39" stroke="#B8A184" strokeWidth="2.2" fill="none" />
          <path d="M18 34C18 30 24 28 32 28C40 28 46 30 46 34C46 37 40 39 32 39C24 39 18 37 18 34Z" fill="#CBB99D" stroke={strokeColor} strokeWidth="2" />
          <path d="M24 15C24 11 30 9 33 12" stroke="#A8907A" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M12 46L14 50M52 46L50 50" stroke="#B8A184" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    // 復古扶手椅 — high wings, four buttons, rolled arms, turned feet.
    case 'furn-armchair-wing':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M14 12H50V38H14V12Z" fill="#96685C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M12 10H20V32H12V10ZM44 10H52V32H44V10Z" fill="#96685C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <circle cx="26" cy="20" r="2.2" fill="#7A5248" /><circle cx="38" cy="20" r="2.2" fill="#7A5248" />
          <circle cx="26" cy="29" r="2.2" fill="#7A5248" /><circle cx="38" cy="29" r="2.2" fill="#7A5248" />
          <rect x="8" y="30" width="9" height="14" rx="4.5" fill="#A8756A" stroke={strokeColor} strokeWidth="2" />
          <rect x="47" y="30" width="9" height="14" rx="4.5" fill="#A8756A" stroke={strokeColor} strokeWidth="2" />
          <rect x="14" y="36" width="36" height="8" rx="3" fill="#A8756A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="14" y="43" width="36" height="10" rx="2" fill="#8A5F52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M18 53V58M46 53V58" stroke="#8A6435" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );

    // 原木搖椅 — five back slats and the two curved runners.
    case 'furn-rocking-chair':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M20 10L18 40M42 10L44 40" stroke="#A3773F" strokeWidth="4" strokeLinecap="round" />
          <path d="M20 12H42M19.6 18H42.4M19.2 24H42.8M18.8 30H43.2" stroke="#C19A63" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M19 7H43" stroke="#8A6435" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M14 42H50V48H14V42Z" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M12 30H20M44 30H52" stroke="#B98A52" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M16 48V54M48 48V54" stroke="#A3773F" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M8 54C14 60 50 60 56 54" stroke="#8A6435" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M40 14C46 16 46 26 40 28" stroke="#C9836F" strokeWidth="5" strokeLinecap="round" fill="none" />
        </svg>
      );

    // 木製餐椅 — ladder back, tie-on cushion, stretchers.
    case 'furn-dining-chair':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M20 8V44M44 8V44" stroke="#A3773F" strokeWidth="4" strokeLinecap="round" />
          <path d="M19 8H45" stroke="#8A6435" strokeWidth="5" strokeLinecap="round" />
          <path d="M21 18H43M21 26H43" stroke="#C19A63" strokeWidth="4" strokeLinecap="round" />
          <rect x="14" y="34" width="36" height="6" rx="2" fill="#C19A63" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="18" y="30" width="28" height="5" rx="2" fill="#8FA9A2" stroke={strokeColor} strokeWidth="2" />
          <path d="M18 40V56M46 40V56" stroke="#A3773F" strokeWidth="4" strokeLinecap="round" />
          <path d="M18 50H46" stroke="#8A6435" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    // ---- 客廳：櫃體與燈 ----

    // 原木電視櫃 — long and low with the TV standing on it.
    case 'furn-tv-console':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="14" y="8" width="36" height="22" rx="3" fill="#2B2B2B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="17" y="11" width="30" height="16" rx="2" fill="#6FA8B8" />
          <path d="M30 30H34V34H30V30Z" fill="#3F3A2C" />
          <rect x="6" y="34" width="52" height="6" rx="2" fill="#8A6435" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="8" y="39" width="48" height="14" rx="2" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="11" y="42" width="20" height="8" rx="1.5" fill="#C9A468" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M15 46H27" stroke="#3F3A2C" strokeWidth="2" strokeLinecap="round" />
          <rect x="34" y="42" width="19" height="8" rx="1.5" fill="#6B4A24" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="36" y="43" width="4" height="6" fill="#3F6F6A" /><rect x="41" y="44" width="3" height="5" fill="#C9836F" />
          <path d="M12 53L9 58M52 53L55 58" stroke="#6B4A24" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    // 玻璃展示櫃 — a tall vitrine with three lit shelves of treasure.
    case 'furn-display-cabinet':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="12" y="6" width="40" height="5" rx="1.5" fill="#7C5C3A" stroke={strokeColor} strokeWidth="2" />
          <rect x="14" y="10" width="36" height="44" fill="#5F4526" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="17" y="13" width="30" height="38" fill="#DBEEFB" opacity="0.5" />
          <path d="M17 25H47M17 37H47" stroke="#8A6A45" strokeWidth="2.5" />
          <path d="M32 13V51" stroke="#8A6A45" strokeWidth="2.5" />
          <path d="M22 24C22 20 24 18 26 18C28 18 30 20 30 24H22Z" fill="#F0D3A0" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="37" y="17" width="6" height="7" rx="2" fill="#7FA8A0" stroke={strokeColor} strokeWidth="1.6" />
          <circle cx="24" cy="34" r="3" fill="#9AA09C" stroke={strokeColor} strokeWidth="1.4" />
          <circle cx="24" cy="29" r="2.2" fill="#9AA09C" stroke={strokeColor} strokeWidth="1.4" />
          <path d="M40 32L43 36L40 40L37 36Z" fill="#A8F0E6" stroke={strokeColor} strokeWidth="1.6" />
          <circle cx="29" cy="45" r="2" fill="#C8A24A" /><circle cx="35" cy="45" r="2" fill="#C8A24A" />
          <rect x="12" y="53" width="40" height="5" rx="1.5" fill="#7C5C3A" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // 弧形立燈 — the arc is the whole picture.
    case 'furn-floor-lamp-arc':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="16" cy="55" rx="12" ry="4" fill="#8E9AA0" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M16 52V26C16 12 30 8 44 12" stroke="#C8B39A" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M36 16L52 16L48 30H40L36 16Z" fill="#F2ECE0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <circle cx="44" cy="31" r="4" fill="#FFF3D6" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M44 38V42M37 36L34 39M51 36L54 39" stroke="#F5C76A" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="16" cy="50" rx="5" ry="2.5" fill="#6F7A80" />
        </svg>
      );

    // ---- 桌子 ----

    // 小圓桌 — single turned column, tripod foot, scalloped rim, a mug on top.
    case 'table-round-small':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="32" cy="28" rx="24" ry="8" fill="#F6EFE3" stroke={strokeColor} strokeWidth={strokeWidth} />
          {[10, 17, 24, 32, 40, 47, 54].map((cx, i) => (
            <circle key={i} cx={cx} cy={i % 2 ? 32 : 31} r="3.4" fill="#E6D9C4" stroke={strokeColor} strokeWidth="1.4" />
          ))}
          <path d="M29 34V44M35 34V44" stroke="#EFE4D2" strokeWidth="4" strokeLinecap="round" />
          <circle cx="32" cy="42" r="5" fill="#EFE4D2" stroke={strokeColor} strokeWidth="2" />
          <path d="M32 48V52" stroke="#EFE4D2" strokeWidth="5" strokeLinecap="round" />
          <path d="M32 52L18 57M32 52L46 57M32 52V58" stroke="#D9C3A5" strokeWidth="4" strokeLinecap="round" />
          <rect x="36" y="17" width="9" height="9" rx="2" fill="#3F6F6A" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M45 20C48 20 48 24 45 24" stroke="#3F6F6A" strokeWidth="2" fill="none" />
          <path d="M22 24V16M19 18L22 14L25 18" stroke="#5B7F4A" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <rect x="18" y="22" width="8" height="6" rx="2" fill="#CFE3E0" stroke={strokeColor} strokeWidth="1.6" />
        </svg>
      );

    // 方形餐桌 — plank top, breadboard ends, four posts, cross stretcher.
    case 'table-dining-square':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="6" y="16" width="52" height="12" rx="2" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M18 16V28M32 16V28M46 16V28" stroke="#8A6435" strokeWidth="1.8" />
          <rect x="6" y="16" width="6" height="12" fill="#8A6435" stroke={strokeColor} strokeWidth="2" />
          <rect x="52" y="16" width="6" height="12" fill="#8A6435" stroke={strokeColor} strokeWidth="2" />
          <rect x="10" y="28" width="44" height="6" rx="1.5" fill="#8A6435" stroke={strokeColor} strokeWidth="2" />
          <path d="M14 34V54M50 34V54M22 34V50M42 34V50" stroke="#A3773F" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M14 50L50 44M50 50L14 44" stroke="#8A6435" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      );

    // 長型餐桌 — trestle ends with the pegged stretcher through them, runner and fruit bowl.
    case 'table-dining-long':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="26" y="14" width="12" height="7" rx="3" fill="#C9A468" stroke={strokeColor} strokeWidth="2" />
          <circle cx="29" cy="14" r="2.6" fill="#D97706" /><circle cx="35" cy="14" r="2.6" fill="#65A30D" /><circle cx="32" cy="11" r="2.6" fill="#DC2626" />
          <rect x="3" y="21" width="58" height="9" rx="2.5" fill="#F2E8D8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="16" y="23" width="32" height="3" rx="1.5" fill="#9DB8B0" />
          <rect x="8" y="30" width="10" height="4" fill="#D9C3A5" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="46" y="30" width="10" height="4" fill="#D9C3A5" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="10" y="33" width="6" height="18" fill="#EFE4D2" stroke={strokeColor} strokeWidth="2" />
          <rect x="48" y="33" width="6" height="18" fill="#EFE4D2" stroke={strokeColor} strokeWidth="2" />
          <rect x="6" y="50" width="14" height="5" rx="2" fill="#D9C3A5" stroke={strokeColor} strokeWidth="2" />
          <rect x="44" y="50" width="14" height="5" rx="2" fill="#D9C3A5" stroke={strokeColor} strokeWidth="2" />
          <rect x="13" y="40" width="38" height="4" rx="2" fill="#C8AD8A" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="18" cy="42" r="1.6" fill="#A3773F" /><circle cx="46" cy="42" r="1.6" fill="#A3773F" />
        </svg>
      );

    // 圓形茶几 — round top, hoop base, cane lower tier, a candle.
    case 'table-coffee-round':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="36" y="14" width="8" height="8" rx="2" fill="#F2ECE0" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M40 14V10" stroke="#FBBF24" strokeWidth="3" strokeLinecap="round" />
          <rect x="16" y="17" width="16" height="4" rx="1.5" fill="#7FA8A0" stroke={strokeColor} strokeWidth="1.6" transform="rotate(-6 24 19)" />
          <ellipse cx="32" cy="27" rx="26" ry="9" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="26" rx="16" ry="5" fill="none" stroke="#8A6435" strokeWidth="2.2" />
          <path d="M12 32V44M52 32V44M32 34V46" stroke="#7A6A58" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="32" cy="45" rx="16" ry="5" fill="#CFA96B" stroke={strokeColor} strokeWidth="2" />
          <ellipse cx="32" cy="53" rx="20" ry="5" fill="none" stroke="#7A6A58" strokeWidth="3" />
        </svg>
      );

    // 藤編邊桌 — a woven drum with no legs at all, glass top, a shell.
    case 'table-side-rattan':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M22 24C22 22 26 20 30 20C34 20 36 24 33 26C30 27 22 26 22 24Z" fill="#F0D3A0" stroke={strokeColor} strokeWidth="1.8" />
          <ellipse cx="32" cy="26" rx="22" ry="7" fill="#DBEEFB" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="26" rx="22" ry="7" fill="none" stroke="#C9A468" strokeWidth="3" />
          <path d="M12 26L15 52C15 55 22 57 32 57C42 57 49 55 49 52L52 26" fill="#CFA96B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M18 27L20 55M25 28L26 57M32 28V57M39 28L38 57M46 27L44 55" stroke="#BD9557" strokeWidth="1.8" />
          <path d="M13 34C21 37 43 37 51 34M14.5 44C22 47 42 47 49.5 44" stroke="#A8834B" strokeWidth="2.6" fill="none" />
        </svg>
      );

    // 折疊露營桌 — slatted top over a scissor X-frame with the hinge bolt showing.
    case 'table-folding':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="38" y="16" width="10" height="9" rx="2.5" fill="#3F6F6A" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="6" y="24" width="52" height="4" rx="2" fill="#D8B98A" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="6" y="29" width="52" height="4" rx="2" fill="#CDAD7C" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="6" y="34" width="52" height="4" rx="2" fill="#D8B98A" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M14 38L34 56M34 38L14 56M30 38L50 56M50 38L30 56" stroke="#C8B39A" strokeWidth="3.6" strokeLinecap="round" />
          <circle cx="24" cy="47" r="3.2" fill="#6B6257" stroke={strokeColor} strokeWidth="1.6" />
          <circle cx="40" cy="47" r="3.2" fill="#6B6257" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M12 57H18M30 57H36M46 57H52" stroke="#3F3A2C" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
      );

    // 柚木戶外桌 — weathered slats with the parasol hole, A-frame legs.
    case 'table-outdoor-teak':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="4" y="18" width="56" height="14" rx="2" fill="#B39468" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M4 22.5H60M4 27.5H60" stroke="#8A7048" strokeWidth="2" />
          <rect x="4" y="18" width="5" height="14" fill="#A88A5E" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="55" y="18" width="5" height="14" fill="#A88A5E" stroke={strokeColor} strokeWidth="1.8" />
          <ellipse cx="32" cy="25" rx="5" ry="3.5" fill="#5F5240" stroke={strokeColor} strokeWidth="2" />
          <path d="M16 32L10 56M22 32L28 56M42 32L36 56M48 32L54 56" stroke="#9C8058" strokeWidth="4" strokeLinecap="round" />
          <path d="M14 42H24M40 42H50" stroke="#8A7048" strokeWidth="3" strokeLinecap="round" />
          <path d="M19 47H45" stroke="#8A7048" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    // 松木工作桌 — the pegboard and the vice are what make it a workbench.
    case 'desk-work-pine':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="10" y="5" width="44" height="22" rx="2" fill="#B9A184" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {[16, 24, 32, 40, 48].map((x) => [10, 16, 22].map((y) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="#8A7A62" />
          )))}
          <path d="M18 8V20" stroke="#6B7280" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M32 8L34 20" stroke="#8A6435" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M46 9V19" stroke="#3F6F6A" strokeWidth="3.4" strokeLinecap="round" />
          <rect x="4" y="27" width="56" height="8" rx="2" fill="#D8B98A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M4 31H60" stroke="#C19A63" strokeWidth="1.6" />
          <rect x="4" y="30" width="9" height="7" rx="1.5" fill="#6B7280" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M12 44V56M52 44V56M12 35V44M52 35V44" stroke="#C19A63" strokeWidth="5" strokeLinecap="round" />
          <rect x="12" y="42" width="40" height="4" rx="1.5" fill="#A3773F" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="16" y="46" width="14" height="9" rx="1.5" fill="#C9836F" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="34" y="46" width="14" height="9" rx="1.5" fill="#8FA9A2" stroke={strokeColor} strokeWidth="1.8" />
        </svg>
      );

    // ---- 臥室 ----

    // 原木單人床 — narrow, slatted head and foot boards, one pillow.
    case 'bed-single-wood':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="4" y="10" width="6" height="42" rx="2" fill="#8A6435" stroke={strokeColor} strokeWidth="2" />
          <path d="M9 15H21M9 22H21M9 29H21M9 36H21" stroke="#C19A63" strokeWidth="4" strokeLinecap="round" />
          <rect x="19" y="10" width="6" height="42" rx="2" fill="#8A6435" stroke={strokeColor} strokeWidth="2" />
          <rect x="24" y="16" width="34" height="30" rx="4" fill="#F7F3EA" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="26" y="20" width="12" height="22" rx="3" fill="#EFE4D2" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="42" y="17" width="16" height="28" rx="3" fill="#8FA9A2" stroke={strokeColor} strokeWidth="2" />
          <rect x="38" y="18" width="5" height="26" fill="#C9836F" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="56" y="12" width="5" height="38" rx="2" fill="#8A6435" stroke={strokeColor} strokeWidth="2" />
          <path d="M8 52V57M20 52V57M56 50V56" stroke="#8A6435" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
      );

    // 帳篷風格床 — the A-frame canopy, bunting and fairy lights.
    case 'bed-canopy-tent':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 6L56 40H8L32 6Z" fill="#F0E8D8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M32 8V38" stroke="#8A6435" strokeWidth="2.4" />
          <path d="M20 22L26 22L23 28L20 22ZM30 22L36 22L33 28L30 22ZM40 22L46 22L43 28L40 22Z" fill="#E8A09A" stroke={strokeColor} strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="24" cy="33" r="2.4" fill="#FFF2CC" stroke={strokeColor} strokeWidth="1.4" />
          <circle cx="32" cy="35" r="2.4" fill="#FFF2CC" stroke={strokeColor} strokeWidth="1.4" />
          <circle cx="40" cy="33" r="2.4" fill="#FFF2CC" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="10" y="40" width="44" height="8" rx="2.5" fill="#F7F3EA" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="14" y="41" width="12" height="6" rx="2" fill="#F2ECE0" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="32" y="41" width="20" height="6" rx="2" fill="#E8A09A" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="8" y="47" width="48" height="6" rx="2" fill="#C19A63" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M12 53V57M52 53V57" stroke="#A3773F" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
      );

    // 抽屜櫃 — six drawers with cut-out finger pulls, a wood top.
    case 'furn-dresser':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="8" y="14" width="48" height="5" rx="2" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="18" y="9" width="14" height="5" rx="1.5" fill="#C9A468" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="20" y="6" width="10" height="4" rx="1.5" fill="#8FA9A2" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="38" y="7" width="10" height="7" rx="3" fill="#CFE3E0" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="10" y="18" width="44" height="32" rx="2" fill="#E6E1D7" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {[20, 30, 40].map((y) => [12, 33].map((x) => (
            <g key={`${x}-${y}`}>
              <rect x={x} y={y} width="19" height="9" rx="1.5" fill="#F3EFE8" stroke={strokeColor} strokeWidth="1.6" />
              <path d={`M${x + 6} ${y + 2.2}H${x + 13}`} stroke="#9AA4A8" strokeWidth="2" strokeLinecap="round" />
            </g>
          )))}
          <path d="M14 50L11 58M50 50L53 58" stroke="#B98A52" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
      );

    // 梳妝台 — round mirror on two uprights over a whitewashed table.
    case 'furn-vanity':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <circle cx="32" cy="18" r="14" fill="#CFE3E0" stroke="#E6D9C4" strokeWidth="4" />
          <circle cx="32" cy="18" r="14" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M25 12C23 15 23 21 25 24" stroke="#F4FBFD" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M20 32V38M44 32V38" stroke="#D9C3A5" strokeWidth="3" strokeLinecap="round" />
          <rect x="8" y="37" width="48" height="6" rx="2" fill="#F2E8D8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="12" y="42" width="40" height="8" rx="1.5" fill="#E6D9C4" stroke={strokeColor} strokeWidth="2" />
          <rect x="15" y="44" width="14" height="5" rx="1.5" fill="#F7F1E6" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="35" y="44" width="14" height="5" rx="1.5" fill="#F7F1E6" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="22" cy="46.5" r="1.6" fill="#C8A24A" /><circle cx="42" cy="46.5" r="1.6" fill="#C8A24A" />
          <path d="M16 50V58M48 50V58" stroke="#E6D9C4" strokeWidth="4" strokeLinecap="round" />
          <rect x="12" y="31" width="7" height="7" rx="2" fill="#CFE3E0" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="46" y="33" width="6" height="5" rx="1.5" fill="#E8A09A" stroke={strokeColor} strokeWidth="1.6" />
        </svg>
      );

    // 全身鏡 — leaning, with a scarf over the corner.
    case 'furn-mirror-standing':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M18 8H46V54H18V8Z" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" transform="rotate(4 32 31)" />
          <path d="M22 12H42V50H22V12Z" fill="#DFEAEE" stroke={strokeColor} strokeWidth="2" transform="rotate(4 32 31)" />
          <path d="M27 16L34 44" stroke="#F4FBFD" strokeWidth="4" strokeLinecap="round" opacity="0.8" transform="rotate(4 32 31)" />
          <rect x="14" y="53" width="36" height="5" rx="2.5" fill="#8A9AA2" stroke={strokeColor} strokeWidth="2" />
          <path d="M45 12C48 20 47 28 44 34" stroke="#C9836F" strokeWidth="5" strokeLinecap="round" fill="none" />
        </svg>
      );

    // 衣帽架 — the post, two rings of pegs, a straw hat and a tote.
    case 'furn-coat-rack':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 8V52" stroke="#B98A52" strokeWidth="5" strokeLinecap="round" />
          <circle cx="32" cy="6" r="3.4" fill="#8A6435" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M32 12L22 17M32 12L42 17M32 20L23 26M32 20L41 26" stroke="#A3773F" strokeWidth="4" strokeLinecap="round" />
          <path d="M32 52L18 58M32 52L46 58M32 52V58" stroke="#8A6435" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="44" cy="18" rx="12" ry="4" fill="#E8D5A8" stroke={strokeColor} strokeWidth="2" transform="rotate(-16 44 18)" />
          <path d="M39 16C39 12 42 10 45 11C48 12 48 15 47 17" fill="#DCC78E" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M18 26C18 30 22 30 22 26" stroke="#7A978F" strokeWidth="2" fill="none" />
          <rect x="13" y="28" width="14" height="14" rx="2" fill="#8FA9A2" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // ---- 收納・書房 ----

    // 梯形書架 — the lean, and the shelves getting shallower going up.
    case 'furn-bookcase-ladder':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M14 56L20 6M50 56L44 6" stroke="#98A8AD" strokeWidth="4" strokeLinecap="round" />
          <rect x="19" y="8" width="26" height="4" rx="1.5" fill="#E6E1D7" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="18" y="20" width="28" height="4" rx="1.5" fill="#E6E1D7" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="17" y="32" width="30" height="4" rx="1.5" fill="#E6E1D7" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="15" y="44" width="34" height="4" rx="1.5" fill="#E6E1D7" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="26" y="2" width="12" height="7" rx="1.5" fill="#B98A52" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="21" y="14" width="5" height="7" fill="#7C3AED" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="27" y="15" width="4" height="6" fill="#9DB8B0" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="20" y="26" width="7" height="7" rx="2" fill="#C9A48A" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M22 33C21 37 19 40 17 42M26 33C27 37 28 39 30 41" stroke="#5B7F4A" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <rect x="19" y="37" width="5" height="8" fill="#3F6F6A" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="25" y="38" width="5" height="7" fill="#C9836F" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="31" y="37" width="5" height="8" fill="#E8C37A" stroke={strokeColor} strokeWidth="1.4" />
        </svg>
      );

    // 文件櫃 — four steel drawers with label holders, a plant on top.
    case 'furn-filing-cabinet':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M22 12C20 8 22 4 25 5M28 12C30 8 34 6 36 8M25 12C25 6 27 3 29 3" stroke="#5B7F4A" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M21 12H33L31 18H23L21 12Z" fill="#C2703D" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <rect x="36" y="14" width="12" height="3" rx="1" fill="#C9836F" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="37" y="16" width="12" height="3" rx="1" fill="#E8C37A" stroke={strokeColor} strokeWidth="1.4" />
          <rect x="14" y="18" width="36" height="4" rx="1.5" fill="#6F7A80" stroke={strokeColor} strokeWidth="2" />
          <rect x="16" y="21" width="32" height="34" rx="2" fill="#8E9AA0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {[23, 31, 39, 47].map((y) => (
            <g key={y}>
              <rect x="18" y={y} width="28" height="7" rx="1.2" fill="#A3AEB3" stroke={strokeColor} strokeWidth="1.5" />
              <path d={`M26 ${y + 1.8}H38`} stroke="#4B5563" strokeWidth="2" strokeLinecap="round" />
              <rect x="27" y={y + 3.6} width="10" height="2.4" rx="0.6" fill="#F2ECE0" />
            </g>
          ))}
          <rect x="18" y="55" width="28" height="3" rx="1" fill="#5B6469" stroke={strokeColor} strokeWidth="1.6" />
        </svg>
      );

    // 藤編收納籃 — five weave courses, rope handles, lid slightly ajar.
    case 'furn-storage-basket':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="33" cy="17" rx="24" ry="7" fill="#D9B57F" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(-5 33 17)" />
          <ellipse cx="33" cy="13" rx="6" ry="3" fill="#A8834B" stroke={strokeColor} strokeWidth="1.8" transform="rotate(-5 33 17)" />
          <path d="M11 22L14 52C14 55 22 57 32 57C42 57 50 55 50 52L53 22" fill="#CFA96B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M11.7 29C20 32 44 32 52.3 29M12.6 37C21 40 43 40 51.4 37M13.4 45C21 48 43 48 50.6 45" stroke="#BD9557" strokeWidth="2.6" fill="none" />
          <path d="M9 36C5 36 5 44 9 44M55 36C59 36 59 44 55 44" stroke="#E5D6BD" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M16 21C18 25 24 25 26 22" stroke="#8FA9A2" strokeWidth="4" strokeLinecap="round" fill="none" />
        </svg>
      );

    // 木製畫架 — tripod, half-finished canvas, palette hooked on a leg.
    case 'furn-easel':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M18 58L26 6M46 58L38 6M32 8V58" stroke="#C19A63" strokeWidth="4" strokeLinecap="round" />
          <rect x="14" y="10" width="36" height="30" rx="2" fill="#C19A63" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="17" y="13" width="30" height="24" fill="#F7F3EA" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="17" y="13" width="30" height="11" fill="#A9D3E0" />
          <rect x="17" y="24" width="30" height="3" fill="#4F8FA8" />
          <path d="M24 24L30 16L36 24H24Z" fill="#7A9C5C" stroke={strokeColor} strokeWidth="1.4" strokeLinejoin="round" />
          <rect x="12" y="40" width="40" height="4" rx="1.5" fill="#8A6435" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="47" cy="49" r="8" fill="#C9A468" stroke={strokeColor} strokeWidth="2" />
          <circle cx="44" cy="47" r="1.8" fill="#DC2626" /><circle cx="49" cy="46" r="1.8" fill="#2563EB" /><circle cx="48" cy="52" r="1.8" fill="#F59E0B" />
        </svg>
      );

    // 桌上地球儀 — the tilted sphere in its meridian ring.
    case 'furn-globe':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <g transform="rotate(-14 32 28)">
            <circle cx="32" cy="28" r="19" fill="#7FB0C8" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M24 18C28 16 34 17 36 21C38 25 33 27 28 26C24 25 21 21 24 18Z" fill="#8FAE68" stroke={strokeColor} strokeWidth="1.5" />
            <path d="M36 32C41 31 45 34 44 38C43 42 37 42 34 39C32 36 33 33 36 32Z" fill="#7A9C5C" stroke={strokeColor} strokeWidth="1.5" />
            <path d="M18 32C22 31 25 35 23 39C21 42 17 41 16 37C15 34 16 33 18 32Z" fill="#8FAE68" stroke={strokeColor} strokeWidth="1.5" />
            <path d="M32 7V49" stroke="#C8A24A" strokeWidth="3" strokeLinecap="round" />
            <path d="M32 9C42 9 50 17 50 28C50 39 42 47 32 47" stroke="#C8A24A" strokeWidth="3" fill="none" strokeLinecap="round" />
          </g>
          <path d="M32 47V52" stroke="#B98A52" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="32" cy="55" rx="13" ry="4" fill="#8A6435" stroke={strokeColor} strokeWidth={strokeWidth} />
        </svg>
      );

    // 書本堆 — five books slightly out of true, a bookmark and glasses.
    case 'furn-book-stack':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="8" y="46" width="48" height="9" rx="2" fill="#3F6F6A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="11" y="47.5" width="43" height="6" rx="1.5" fill="#F4ECD8" />
          <rect x="8" y="46" width="5" height="9" fill="#3F6F6A" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="11" y="38" width="46" height="8" rx="2" fill="#C9836F" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" transform="rotate(-3 34 42)" />
          <rect x="9" y="30" width="46" height="8" rx="2" fill="#E8C37A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" transform="rotate(2 32 34)" />
          <path d="M40 37V44L37 41L34 44V37" fill="#DC2626" stroke={strokeColor} strokeWidth="1.4" strokeLinejoin="round" />
          <rect x="12" y="23" width="42" height="7" rx="2" fill="#8FA9A2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" transform="rotate(-4 33 26)" />
          <rect x="13" y="16" width="40" height="7" rx="2" fill="#9C7FB8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" transform="rotate(1 33 19)" />
          <circle cx="24" cy="11" r="5.5" fill="none" stroke="#6B6257" strokeWidth="2.6" />
          <circle cx="40" cy="11" r="5.5" fill="none" stroke="#6B6257" strokeWidth="2.6" />
          <path d="M29.5 11H34.5" stroke="#6B6257" strokeWidth="2.6" />
        </svg>
      );

    // 桌上收納盒 — three compartments: pens, scissors, tape.
    case 'furn-desk-organizer':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M15 20V38M20 16V38M25 20V38" stroke="#3F6F6A" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M20 16L18 12M20 16L22 12" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" />
          <path d="M34 14V32M38 14V32" stroke="#B8BEC4" strokeWidth="3" strokeLinecap="round" />
          <circle cx="34" cy="12" r="3.4" fill="none" stroke="#E8A09A" strokeWidth="2.4" />
          <circle cx="38" cy="12" r="3.4" fill="none" stroke="#E8A09A" strokeWidth="2.4" />
          <circle cx="49" cy="34" r="7" fill="#E8C37A" stroke={strokeColor} strokeWidth="2" />
          <circle cx="49" cy="34" r="2.6" fill="#FDF3E3" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="6" y="34" width="52" height="18" rx="3" fill="#C19A63" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M28 34V52M42 34V52" stroke="#A3773F" strokeWidth="2.6" />
          <rect x="6" y="48" width="52" height="6" rx="2" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
        </svg>
      );

    // 檯燈 — the two-jointed arm and the cone tipped over the desk.
    case 'furn-desk-lamp':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="20" cy="54" rx="14" ry="5" fill="#3F6F6A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="20" cy="50" rx="6" ry="2.6" fill="#2C4F4B" />
          <path d="M20 50L28 30" stroke="#5F8F89" strokeWidth="4" strokeLinecap="round" />
          <circle cx="28" cy="29" r="4" fill="#C8A24A" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M28 29L42 22" stroke="#5F8F89" strokeWidth="4" strokeLinecap="round" />
          <path d="M35 14L54 22L48 34L36 26L35 14Z" fill="#3F6F6A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M38 27L47 33" stroke="#FFF3D6" strokeWidth="5" strokeLinecap="round" />
          <path d="M40 38L36 44M48 40L47 47M54 37L57 42" stroke="#F5C76A" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    // ---- 廚房・餐廳 ----

    // 島型吧台 — the overhang and the two stools tucked under it.
    case 'furn-kitchen-island':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <ellipse cx="42" cy="14" rx="7" ry="3" fill="#8FA9A2" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="14" y="13" width="13" height="4" rx="1.5" fill="#C19A63" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="4" y="17" width="56" height="7" rx="2.5" fill="#E6E1D7" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="10" y="23" width="44" height="26" rx="2" fill="#3F6F6A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          {[13, 27, 41].map((x) => (
            <g key={x}>
              <rect x={x} y="26" width="11" height="20" rx="1.5" fill="#4A7F79" stroke={strokeColor} strokeWidth="1.6" />
              <path d={`M${x + 8} 31V41`} stroke="#C8A24A" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          ))}
          <rect x="10" y="48" width="44" height="4" rx="1.5" fill="#2C4F4B" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M20 52V58M44 52V58" stroke="#8E9AA0" strokeWidth="3.4" strokeLinecap="round" />
          <ellipse cx="20" cy="53" rx="8" ry="3" fill="#B98A52" stroke={strokeColor} strokeWidth="2" />
          <ellipse cx="44" cy="53" rx="8" ry="3" fill="#B98A52" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // 廚房收納櫃 — glazed above, solid below, jars showing through.
    case 'furn-pantry-cabinet':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="10" y="4" width="44" height="5" rx="1.5" fill="#D9C3A5" stroke={strokeColor} strokeWidth="2" />
          <rect x="12" y="8" width="40" height="48" rx="2" fill="#EFE4D2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="15" y="11" width="34" height="20" fill="#DBEEFB" stroke={strokeColor} strokeWidth="2" />
          <path d="M32 11V31M15 21H49" stroke="#E6D9C4" strokeWidth="2.4" />
          {[[19, 15, '#C9836F'], [25, 15, '#8FA9A2'], [38, 15, '#E8C37A'], [43, 15, '#9DB8B0'], [20, 25, '#C2703D'], [26, 25, '#CFE3E0'], [39, 25, '#C9836F']].map(([x, y, c], i) => (
            <rect key={i} x={x as number} y={y as number} width="4.5" height="6" rx="1.2" fill={c as string} stroke={strokeColor} strokeWidth="1.2" />
          ))}
          <rect x="12" y="31" width="40" height="4" rx="1" fill="#D9C3A5" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="15" y="36" width="15" height="18" rx="1.5" fill="#F7F1E6" stroke={strokeColor} strokeWidth="2" />
          <rect x="34" y="36" width="15" height="18" rx="1.5" fill="#F7F1E6" stroke={strokeColor} strokeWidth="2" />
          <rect x="18" y="39" width="9" height="12" rx="1" fill="#E9DCC7" />
          <rect x="37" y="39" width="9" height="12" rx="1" fill="#E9DCC7" />
          <circle cx="29" cy="45" r="1.8" fill="#C8A24A" /><circle cx="35" cy="45" r="1.8" fill="#C8A24A" />
          <rect x="10" y="55" width="44" height="4" rx="1.5" fill="#D9C3A5" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // 微波爐 — dark window, grille bars, keypad, handle.
    case 'furn-microwave':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="4" y="18" width="56" height="30" rx="4" fill="#DFE3E6" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="8" y="22" width="34" height="22" rx="2.5" fill="#C7CDD1" stroke={strokeColor} strokeWidth="2" />
          <rect x="11" y="25" width="28" height="16" rx="2" fill="#2F3A40" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M13 30H37M13 34H37M13 38H37" stroke="#4B5563" strokeWidth="1.4" />
          <rect x="43" y="24" width="4" height="18" rx="2" fill="#8E9AA0" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="49" y="23" width="9" height="7" rx="1.5" fill="#1F2937" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M51 26.5H56" stroke="#7FF0DD" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="53" cy="38" r="4" fill="#9AA4A8" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M53 35V38" stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 48V52M52 48V52" stroke="#4B5563" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
      );

    // 烤箱 — hob rings on top, two doors, four dials, something baking.
    case 'furn-oven':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="8" y="6" width="48" height="7" rx="2" fill="#3F474B" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <circle cx="20" cy="9.5" r="3.4" fill="none" stroke="#8E9AA0" strokeWidth="2" />
          <circle cx="30" cy="9.5" r="3.4" fill="none" stroke="#8E9AA0" strokeWidth="2" />
          <circle cx="40" cy="9.5" r="3.4" fill="none" stroke="#8E9AA0" strokeWidth="2" />
          <circle cx="49" cy="9.5" r="3.4" fill="none" stroke="#8E9AA0" strokeWidth="2" />
          <rect x="10" y="13" width="44" height="45" rx="3" fill="#C7CDD1" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="12" y="15" width="40" height="8" rx="2" fill="#5B6469" stroke={strokeColor} strokeWidth="1.8" />
          {[19, 27, 37, 45].map((x) => <circle key={x} cx={x} cy="19" r="2.6" fill="#C8A24A" stroke={strokeColor} strokeWidth="1.4" />)}
          <rect x="13" y="25" width="38" height="21" rx="2.5" fill="#AAB3B8" stroke={strokeColor} strokeWidth="2" />
          <rect x="17" y="29" width="30" height="14" rx="2" fill="#33403F" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="20" y="32" width="24" height="9" rx="1.5" fill="#FFB347" />
          <path d="M15 27H49" stroke="#8E9AA0" strokeWidth="3" strokeLinecap="round" />
          <rect x="13" y="48" width="38" height="9" rx="2.5" fill="#AAB3B8" stroke={strokeColor} strokeWidth="2" />
          <rect x="18" y="51" width="28" height="4" rx="1.5" fill="#33403F" />
          <path d="M15 50H49" stroke="#8E9AA0" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    // 餐具架 — plates on edge below, mugs hanging above.
    case 'furn-dish-rack':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="6" y="16" width="52" height="4" rx="2" fill="#B8BEC4" stroke={strokeColor} strokeWidth="2" />
          <path d="M10 20V50M54 20V50" stroke="#B8BEC4" strokeWidth="3" strokeLinecap="round" />
          <rect x="42" y="8" width="10" height="8" rx="2" fill="#DFE3E6" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M45 8V4M48 8V3M51 8V5" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
          <path d="M14 20V26C14 30 22 30 22 26V20" fill="#3F6F6A" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M22 22C26 22 26 27 22 27" stroke="#3F6F6A" strokeWidth="2" fill="none" />
          <path d="M30 20V26C30 30 38 30 38 26V20" fill="#C9836F" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M38 22C42 22 42 27 38 27" stroke="#C9836F" strokeWidth="2" fill="none" />
          <ellipse cx="20" cy="42" rx="4" ry="12" fill="#F7F3EA" stroke={strokeColor} strokeWidth="2" />
          <ellipse cx="30" cy="42" rx="4" ry="12" fill="#CFE3E0" stroke={strokeColor} strokeWidth="2" />
          <ellipse cx="40" cy="42" rx="4" ry="12" fill="#F7F3EA" stroke={strokeColor} strokeWidth="2" />
          <rect x="6" y="52" width="52" height="6" rx="2.5" fill="#8FA9A2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
        </svg>
      );

    // ---- 小型裝飾 ----

    // 陶瓷花瓶 — bulbous body, throwing rings, three stems.
    case 'deco-vase-ceramic':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M32 26V8M32 12C28 10 25 6 26 3M32 16C36 13 40 11 42 7" stroke="#5B7F4A" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M25 9C22 7 21 4 23 2C26 2 27 6 25 9Z" fill="#6B9459" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M40 11C43 9 44 5 42 3C39 4 38 9 40 11Z" fill="#5B7F4A" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M30 6C28 3 30 1 32 1C34 2 34 5 32 7L30 6Z" fill="#6B9459" stroke={strokeColor} strokeWidth="1.5" />
          <path d="M27 26H37V32C43 36 45 44 41 51C38 56 26 56 23 51C19 44 21 36 27 32V26Z" fill="#DFEEEA" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M25 24H39V28H25V24Z" fill="#CFE3E0" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M21.5 42C26 45 38 45 42.5 42M22 47C26 50 38 50 42 47" stroke="#B9D2CD" strokeWidth="2.2" fill="none" />
          <ellipse cx="32" cy="55" rx="9" ry="3" fill="#CFE3E0" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // 木質相框 — leaning, cream mount, a beach photo.
    case 'deco-photo-frame':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M40 46L48 56" stroke="#8A6435" strokeWidth="4" strokeLinecap="round" />
          <rect x="10" y="8" width="44" height="42" rx="3" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="15" y="13" width="34" height="32" fill="#F7F3EA" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="20" y="18" width="24" height="22" fill="#8FC4D8" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="21" y="30" width="22" height="5" fill="#3F8FA8" />
          <rect x="21" y="34" width="22" height="5" fill="#E8D5A8" />
          <circle cx="38" cy="23" r="3.4" fill="#F5C76A" stroke={strokeColor} strokeWidth="1.4" />
          <path d="M14 48H50" stroke="#8A6435" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    // 香氛蠟燭 — three pillars of different heights on a slate coaster, two lit.
    case 'deco-candle-set':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M18 16C18 12 21 11 21 8C21 12 24 13 24 16C24 19 18 19 18 16Z" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M44 30C44 27 46 26 46 24C46 27 49 28 49 30C49 33 44 33 44 30Z" fill="#FBBF24" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
          <rect x="14" y="19" width="14" height="30" rx="2" fill="#F7F3EA" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M14 22C17 24 25 24 28 22" stroke="#E6DCC8" strokeWidth="2.4" fill="none" />
          <rect x="29" y="28" width="12" height="21" rx="2" fill="#EFE0C8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M29 31C32 33 38 33 41 31" stroke="#E6DCC8" strokeWidth="2.2" fill="none" />
          <path d="M35 28V24" stroke="#3F3A2C" strokeWidth="2" strokeLinecap="round" />
          <rect x="41" y="33" width="11" height="16" rx="2" fill="#E8D5C0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M41 36C44 38 49 38 52 36" stroke="#E6DCC8" strokeWidth="2.2" fill="none" />
          <ellipse cx="32" cy="51" rx="26" ry="6" fill="#6F7A80" stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M9 52C14 55 20 54 24 51" stroke="#9C8060" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </svg>
      );

    // 小型時鐘 — wooden case, two bells, hands at ten past ten.
    case 'deco-table-clock':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M14 14C10 10 12 5 17 6C21 7 21 12 18 15" fill="#C8A24A" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M50 14C54 10 52 5 47 6C43 7 43 12 46 15" fill="#C8A24A" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="32" cy="32" r="22" fill="#B98A52" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="32" cy="32" r="17" fill="#F7F3EA" stroke={strokeColor} strokeWidth="2" />
          <path d="M32 18V22M32 42V46M18 32H22M42 32H46" stroke="#3F3A2C" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M40 22L38 24M24 42L22 44M42 40L44 42M22 20L24 22" stroke="#3F3A2C" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M32 32L24 26M32 32L41 27" stroke="#3F3A2C" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="32" cy="32" r="2.6" fill="#C8A24A" stroke={strokeColor} strokeWidth="1.4" />
          <path d="M18 51L14 58M46 51L50 58" stroke="#8A6435" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );

    // 抱枕組 — three cushions, one tufted, one striped, one bolster.
    case 'deco-cushion-set':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="8" y="10" width="32" height="32" rx="6" fill="#8FA9A2" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <circle cx="13" cy="15" r="2.6" fill="#7A978F" /><circle cx="35" cy="15" r="2.6" fill="#7A978F" />
          <circle cx="13" cy="37" r="2.6" fill="#7A978F" /><circle cx="35" cy="37" r="2.6" fill="#7A978F" />
          <rect x="32" y="18" width="28" height="28" rx="6" fill="#E8D5C0" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" transform="rotate(8 46 32)" />
          <path d="M34 26H60M33 34H59M34 42H58" stroke="#C9836F" strokeWidth="3" strokeLinecap="round" transform="rotate(8 46 32)" />
          <rect x="6" y="44" width="42" height="14" rx="7" fill="#E8A09A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <circle cx="8" cy="51" r="4" fill="#D68F89" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="46" cy="51" r="4" fill="#D68F89" stroke={strokeColor} strokeWidth="1.8" />
        </svg>
      );

    // 布偶熊 — knitted, scarf, one ear stitched crooked.
    case 'deco-plush-toy':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <circle cx="20" cy="14" r="7" fill="#C9A48A" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="45" cy="11" r="7" fill="#C9A48A" stroke={strokeColor} strokeWidth={strokeWidth} transform="rotate(14 45 11)" />
          <circle cx="32" cy="20" r="15" fill="#D6B296" stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="25" rx="7" ry="5.5" fill="#EFE0CD" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="32" cy="23" r="2.6" fill="#5B4636" />
          <path d="M29 27C30 29 34 29 35 27" stroke="#5B4636" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <circle cx="26" cy="17" r="2.2" fill="#3F3A2C" /><circle cx="38" cy="17" r="2.2" fill="#3F3A2C" />
          <path d="M18 36C22 33 42 33 46 36" stroke="#C9836F" strokeWidth="6" strokeLinecap="round" fill="none" />
          <path d="M44 38L48 48" stroke="#C9836F" strokeWidth="5" strokeLinecap="round" />
          <path d="M14 42C14 36 22 34 32 34C42 34 50 36 50 42V50C50 55 42 57 32 57C22 57 14 55 14 50V42Z" fill="#C9A48A" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <ellipse cx="32" cy="48" rx="8" ry="8" fill="#E8D5C0" stroke={strokeColor} strokeWidth="1.8" />
          <circle cx="12" cy="44" r="5" fill="#C9A48A" stroke={strokeColor} strokeWidth="2" />
          <circle cx="52" cy="44" r="5" fill="#C9A48A" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );

    // 小鯨魚雕像 — carved driftwood on a wave plinth, three-bead spout.
    case 'deco-whale-figurine':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <circle cx="34" cy="9" r="3.4" fill="#CFE3E0" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="32" cy="15" r="2.6" fill="#CFE3E0" stroke={strokeColor} strokeWidth="1.4" />
          <circle cx="31" cy="19" r="1.8" fill="#CFE3E0" />
          <path d="M12 34C12 26 22 22 34 22C44 22 52 26 52 32C52 38 44 42 34 42C22 42 12 40 12 34Z" fill="#5F7F8C" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M14 36C18 40 28 42 36 41C42 40 46 38 48 36C44 40 38 42 32 42C24 42 17 40 14 36Z" fill="#DFEAEE" stroke={strokeColor} strokeWidth="1.6" />
          <path d="M12 34L4 27V41L12 34Z" fill="#4F6C78" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M34 40C36 44 34 47 30 46C27 45 27 41 30 39" fill="#4F6C78" stroke={strokeColor} strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="44" cy="29" r="2.2" fill="#2F3A40" />
          <path d="M8 50C12 46 18 46 22 50C26 54 32 54 36 50C40 46 46 46 50 50" stroke="#7FA8A0" strokeWidth="4" strokeLinecap="round" fill="none" />
          <rect x="8" y="53" width="46" height="5" rx="2" fill="#8A6435" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
        </svg>
      );

    /* ---------------------------------------------------------------------------------------
     * 拆開三組「兩件商品共用一張圖」。每一組都是不同的兩件東西，只是以前擠在同一個 case 裡：
     * 熱帶木桌/橡木書桌、編織地毯/波西米亞編織地毯、系統流理台/廚房吊櫃。
     * 留下的那一件維持原圖（見上面各自的 case），新的這幾張畫的是另一件的模型。
     * ------------------------------------------------------------------------------------ */

    // 橡木書桌 — the drawer pedestal and the book pile are what tell it from 熱帶木桌's low slab.
    case 'item-desk':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="4" y="22" width="56" height="7" rx="2.5" fill="#B45309" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="8" y="29" width="18" height="26" rx="2" fill="#78350F" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="11" y="32" width="12" height="6" rx="1.2" fill="#A16207" stroke={strokeColor} strokeWidth="1.5" />
          <rect x="11" y="41" width="12" height="6" rx="1.2" fill="#A16207" stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="17" cy="35" r="1.6" fill="#FBBF24" /><circle cx="17" cy="44" r="1.6" fill="#FBBF24" />
          <rect x="50" y="29" width="6" height="26" rx="2" fill="#451A03" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="14" y="15" width="20" height="7" rx="1.5" fill="#1E3A8A" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="16" y="9" width="18" height="6" rx="1.5" fill="#047857" stroke={strokeColor} strokeWidth="1.8" transform="rotate(-4 25 12)" />
        </svg>
      );

    // 編織地毯 — the pale two-tone mat `WovenRugModel` draws, with its woven grid and side fringes.
    case 'item-23':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="6" y="18" width="52" height="28" rx="4" fill="#EBD5B8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="11" y="23" width="42" height="18" rx="2.5" fill="#FCF9F2" stroke={strokeColor} strokeWidth="2" />
          <path d="M14 28H50M14 32H50M14 36H50" stroke="#EBD5B8" strokeWidth="2" strokeLinecap="round" />
          <path d="M18 23V41M32 23V41M46 23V41" stroke="#F1E4CE" strokeWidth="2" />
          <path d="M3 22H6M3 28H6M3 34H6M3 40H6M3 46H6M58 22H61M58 28H61M58 34H61M58 40H61M58 46H61" stroke="#E5D6BD" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    // 系統流理台 — the stainless top, the sink and the faucet. 廚房吊櫃 keeps the glazed wall unit.
    case 'item-cabinet':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M22 22V14C22 10 30 10 30 14V20" stroke="#CBD5E1" strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <rect x="6" y="22" width="52" height="6" rx="2" fill="#94A3B8" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="14" y="24" width="20" height="4" rx="1.5" fill="#475569" stroke={strokeColor} strokeWidth="1.6" />
          <rect x="8" y="28" width="48" height="26" rx="2.5" fill="#F8FAFC" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
          <rect x="12" y="32" width="18" height="18" rx="1.5" fill="#EEF2F5" stroke={strokeColor} strokeWidth="1.8" />
          <rect x="34" y="32" width="18" height="18" rx="1.5" fill="#EEF2F5" stroke={strokeColor} strokeWidth="1.8" />
          <path d="M27 38V44M37 38V44" stroke="#94A3B8" strokeWidth="2.6" strokeLinecap="round" />
          <rect x="8" y="54" width="48" height="4" rx="1.5" fill="#CBD5E1" stroke={strokeColor} strokeWidth="1.8" />
        </svg>
      );

    // Default Fallback matching general categories/lucide elements
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <rect x="12" y="12" width="40" height="40" rx="8" fill="#E2E8F0" stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx="32" cy="32" r="12" fill="#94A3B8" stroke={strokeColor} strokeWidth="2" />
        </svg>
      );
  }
}

export function QVersionIcon(props: QVersionIconProps) {
  const { size = 32, className = "" } = props;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative'
      }}
      className={className}
    >
      {/* Soft grounded shadow beneath every icon, so items read as sitting on
          a surface rather than floating flat against the tile background. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '6%',
          transform: 'translateX(-50%)',
          width: '62%',
          height: '14%',
          borderRadius: '999px',
          background: 'radial-gradient(closest-side, rgba(38,70,83,0.28), transparent 80%)',
          pointerEvents: 'none',
        }}
      />
      {/* Uniform drop-shadow filter gives every hand-drawn icon the same
          amount of lift/depth without having to redraw ~100+ SVGs. */}
      <div style={{ position: 'relative', filter: 'drop-shadow(0 3px 2px rgba(38,70,83,0.22))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <QVersionIconInner {...props} className="" />
      </div>
    </div>
  );
}
