/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import {
  HEAD_ANCHOR,
  HairSpec,
  HairLockPart,
  HairRibbonPart,
  HairScalpPart,
  HatBrim,
  SCALP_COLUMNS,
  SCALP_ROWS,
  buildHairLayout,
  hatHairlineY,
  pressedShellR,
  scalpVertex,
  shadeHairColor,
} from '../../../../constants/hair';
import {
  RIBBON_AROUND,
  RIBBON_STATIONS,
  ribbonIndices,
} from '../../../../constants/hairRibbon';
import {
  FRINGE_TIP_SHADE,
  HANG_BANDS,
  HANG_TIP_SHADE,
  SCALP_BANDS,
  hairMaterial,
} from './hairShading';
import { HAT_PALETTES } from '../../../../constants/hats';
import { CROWN_RING, LEGACY_WEARABLE_FIT } from '../../../../constants/characterRig';
import type { AttachmentPoint } from '../../../../constants/characterRig';
import { DECAL_DEPTH_BIAS } from '../../../../constants/terrain';
import { OutfitModel } from '../../Outfits';
import type { CharacterOutfit, EarringKind, HatKind } from '../types';

/**
 * THE LEGACY WARDROBE — every wearable authored against the legacy body.
 *
 * Moved here verbatim from Avatar.tsx, geometry unchanged. The move is the point: these
 * are MODEL assets, not controller logic, and the numbers below only mean anything against
 * the legacy 0.26 sphere head and 0.135 capsule torso. Keeping them in the controller was
 * what made "the player character" and "this particular set of primitives" the same thing.
 *
 * A future model does not have to re-author these. It mounts them through its own
 * `CharacterAttachments` sockets, whose `scale` refits them — see constants/characterRig.ts.
 * What it must NOT do is assume they will land correctly untransformed, because every
 * offset here was measured off a head that model no longer has.
 */

/* ---------------------------------------------------------------------------
   HAT FITTING
   ---------------------------------------------------------------------------
   Every hat is a child of the head sphere, so head-local coordinates here mean
   radius HEAD_R around the origin. Three of the five used to break that fit in
   the same three ways, and the geometry below is chosen to make each impossible:

   1. A DOME BARELY WIDER THAN THE SKULL. The beret (r 0.29), beanie and cap
      (r 0.278) were all within ~0.02 of HEAD_R, so their open bottom rim landed
      at a latitude where the head is still WIDER than they are. The head then
      bulges out below the rim and the hat reads as a bowl balanced on top
      instead of something pulled on. Every crown below is sized so its rim
      clears the head at the latitude it actually sits at, and every one of them
      is closed off by a real band rather than left as an open shell.

   2. PARTS FLOATING NEXT TO THE HAT. The cap's visor hung at z 0.26 / y -0.05
      with nothing between it and the crown, and its strap sat off the back in
      clear air. Both now overlap the band they fasten to, so they are attached
      geometry rather than nearby geometry.

   3. TRIM AT THE WRONG HEIGHT. The beanie's "folded cuff" was a thin torus part
      way UP the dome and its pompom sat at y 0.28 with the dome top at 0.335 -
      i.e. sunk inside its own hat. Both now key off the numbers that place the
      dome, so they cannot drift apart from it again.

   4. A BAND WORN THROUGH THE EYES. Fixing (1) by making the crowns WIDER than
      the skull created a second problem, because those bands were still at the
      height the old skullcaps sat at. An eye is centred at y 0.035 and is only
      sqrt(0.104^2 + 0.225^2) = 0.248 from the head's axis, so any band wider
      than that does not pass NEAR the eyes - it passes THROUGH them. Measured
      against the eye spheres, the beanie's cuff covered 88% of both eyes, the
      beret's band 82% of one (the tilt puts it on one side only, so the face
      came out lopsided) and the cap's band 37% of both.

      The height that fixes it is not invented: 草帽 and 漁夫帽 were never
      reported as broken, and their lowest parts sit at y 0.107 and 0.100. So
      HAT_BROW_Y below is where a hat's lowest ring belongs on this head, and
      every band is placed by it rather than by eye. A band cannot simply be
      lifted, though - the skull narrows as you go up, so a band raised without
      being taken in stops touching the head and reads as a hoop floating around
      it. `bandRadiusAt` is the other half of the fix, and the two are always
      used together.

   The beret is the only one that tilts, and it tilts by ROTATING ABOUT THE
   HEAD'S OWN CENTRE with no offset. That is what makes the tilt safe: a point
   at height d and radius r stays sqrt(d^2 + r^2) from the head centre through
   any rotation, so checking that once (against HEAD_R) proves the part cannot
   punch through the skull at ANY tilt angle. Offsetting the group first would
   void that guarantee, which is why the old `position={[0.03, 0.14, 0]}` let
   the tilted dome cut into the head on its low side.

   That same property is why the tilt costs the beret height and nothing else:
   in the tilted frame the head is still a sphere about the origin, so
   `bandRadiusAt` reads the same, but the eyes swing to different latitudes, and
   the band has to clear the one that swings HIGHEST. */
const HEAD_R = 0.26;

/** Top of an eye: centred at y 0.035 with r 0.036, so nothing may hang below this. */
const EYE_TOP_Y = 0.035 + 0.036;
/**
 * Where a hat's lowest ring sits: a brow's height above the eyes, which lands on
 * 0.10 — the height 草帽 (0.107) and 漁夫帽 (0.100) already sit at. Derived from
 * the eyes rather than typed, so moving the face moves the hats with it.
 */
const HAT_BROW_Y = EYE_TOP_Y + 0.029;
/** How wide the skull is at a given height: the sphere's own cross-section. */
const headRadiusAt = (y: number) => Math.sqrt(Math.max(0, HEAD_R * HEAD_R - y * y));
/**
 * The radius a band must have to grip the head at height `y` — just outside the
 * skull, never far enough out to float. Raising a band without re-reading this
 * is what turns it into a hoop hanging around the head.
 */
const bandRadiusAt = (y: number) => headRadiusAt(y) + 0.012;

/**
 * The beret's band clears the eye the TILT swings highest rather than the brow
 * line: at rotation z 0.3 one eye sits at latitude 0.082 in the band's own frame,
 * so the band starts above 0.082 + 0.036 (that eye's radius) plus the same brow
 * gap the other hats use. This is the one number the tilt costs — see the note
 * above on why the tilt is otherwise free.
 */
const BERET_BAND_BOTTOM_Y = 0.118;

/** Blend towards white/black in linear space, for trim the palette does not name. */
const mixHat = (hex: string, towards: string, amount: number) =>
  new THREE.Color(hex).lerp(new THREE.Color(towards), amount);

const BERET = HAT_PALETTES['hat-beret'];
const BEANIE = HAT_PALETTES['hat-beanie'];
const SNAPBACK = HAT_PALETTES['hat-snapback'];

/** Lightened, not shadowed - on a maroon this dark a shadowed band is invisible.
 *  The shop icon makes the same call (`bodyShade.mix(0.22)`), so the two agree. */
const BERET_BAND = mixHat(BERET.body, '#ffffff', 0.22);
/** Raised knit ribs, so they catch light rather than reading as grooves. */
const BEANIE_RIB = mixHat(BEANIE.body, '#ffffff', 0.2);
const BEANIE_FOLD = mixHat(BEANIE.trim ?? BEANIE.body, '#000000', 0.28);
const SNAPBACK_SEAM = mixHat(SNAPBACK.body, '#ffffff', 0.16);

/** Ten ribs around the beanie. Stops short of the pole (thetaStart) so they do not
 *  all converge into one z-fighting knot at the top - the pompom covers that gap. */
const BEANIE_RIBS = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);

/**
 * Renders whichever hairstyle the player is wearing.
 *
 * This component does no placement arithmetic at all - every position, rotation and
 * geometry argument is computed by `buildHairLayout`, which fits the style to
 * HEAD_ANCHOR and clamps it into HAIR_ENVELOPE. That is deliberate and is the whole
 * reason hair now stays on the head: there is no code path by which a hairstyle can
 * contribute a transform of its own, so no hairstyle can sit differently from the
 * others. See src/constants/hair.ts, and `npm run audit:hair` for the standing check.
 *
 * The group mounts at the head's own origin with no transform, so head-local
 * coordinates mean the same thing here as they do in the spec.
 *
 * Exported for `scripts/audit-hair.ts`, which walks the element tree this returns
 * and re-measures it, so the audit checks what is drawn rather than trusting that
 * the layout was mapped onto the right geometry arguments.
 */
/**
 * The geometry for one lock, bang or bundle.
 *
 * Two primitives behind one component, chosen by whether the layout tapered the
 * piece. A capsule is a rod with domed ends — correct for a 錫紙燙 bundle, which
 * really is a rope of even thickness — and wrong for anything cut, which is why
 * every hanging lock and every bang used to read as 「粗粗的一根像熱狗」 no matter
 * how thin or how numerous they were made. A cut lock is a cone frustum: full
 * width where it leaves the scalp, {@link LOCK_TIP} of that where the scissors
 * finished it.
 *
 * The cylinder takes the capsule's AXIS length and drops both caps, which is what
 * keeps the swap safe rather than merely plausible. constants/hair.ts clamps in
 * capsule terms and scripts/audit-hair.ts predicts a sphere of the full radius at
 * each axis end; a cylinder of the same axis length lies strictly inside that,
 * whatever the lean. Adding the caps back — the obvious first version — put the
 * top rim 13mm above the predicted bound on the leaning bangs, and the audit
 * caught it. The cost is that a tapered piece is one radius shorter at each end
 * than the capsule it replaces, which the lengths in HAIR_SPECS account for.
 */
/**
 * Built scalp shells, keyed by the numbers that define one.
 *
 * The shell is the one piece of hair that is not a three.js primitive: a primitive
 * can only be cropped at a constant angle, and a constant angle is precisely the
 * straight wall across the temple that {@link HairScalpPart} exists to get rid of.
 * So it is a mesh, and a mesh has to be built once rather than per render.
 *
 * Cached at module scope rather than with `useMemo` because `HairPiece` is
 * deliberately hook-free — `scripts/audit-hair.ts` calls it as a plain function to
 * re-measure what actually gets drawn — and because a fresh BufferGeometry per
 * render would leak one GPU buffer every time an outfit changed. The key is the
 * shell's own solved numbers, so two players wearing the same style share one.
 */
const SCALP_GEOMETRY = new Map<string, THREE.BufferGeometry>();

/**
 * The scalp shell's mesh: a (column, row) grid over the surface `scalpVertex` defines.
 *
 * Nothing here decides any shape. Every vertex comes back from constants/hair.ts, which
 * is what keeps the drawn mesh and the audited layout the same object seen twice.
 */
function scalpGeometry(part: HairScalpPart): THREE.BufferGeometry {
  // `part.key` carries which hat solved this shell, and it has to: a hatted shell has
  // the same radius, rim and tuck as the bare one it was solved from and a completely
  // different surface (see HairScalpPart.press), so keying on the numbers alone hands
  // a hatted head the bare dome out of this cache.
  const key = `${part.key}|${part.radius}|${part.rimRadius}|${part.occiput}|${part.rim.join()}|${part.tuck.join()}`;
  const cached = SCALP_GEOMETRY.get(key);
  if (cached) return cached;

  const rows = SCALP_ROWS + 1;
  const position = new Float32Array(SCALP_COLUMNS * rows * 3);
  // The shell's own UVs. It is the one piece of hair that is not a primitive, so it
  // is also the one that has to supply what legacy/hairShading.ts reads off every
  // other piece for free - see there for the whole convention.
  //
  // v runs 1 at the crown to 0 at the rim, so the shader's `1 - uv.y` comes out as
  // "how far down the head am I", matching the root-to-tip ramp a lock gets from a
  // capsule's own v.
  //
  // u is NOT the column index. It carries the highlight's BREAK PROFILE, computed
  // here because it is a function of azimuth and the mesh's last column indexes
  // back onto the first: a stored `i / SCALP_COLUMNS` would run 0.99 -> 0 across
  // that one shared quad and squeeze the whole dash pattern into a hairline stripe
  // down the back of every head. A periodic function of the column's own yaw has
  // the same value at the shared vertex whichever side it is approached from, so
  // the ring closes with no seam at all.
  const uv = new Float32Array(SCALP_COLUMNS * rows * 2);
  for (let i = 0; i < SCALP_COLUMNS; i++) {
    const dash = Math.pow(Math.abs(Math.sin(part.yaw[i] * 11 + 0.7)), 0.6);
    for (let j = 0; j <= SCALP_ROWS; j++) {
      const [x, y, z] = scalpVertex(part, i, j);
      const o = (i * rows + j) * 3;
      position[o] = x;
      position[o + 1] = y;
      position[o + 2] = z;
      const t = (i * rows + j) * 2;
      uv[t] = dash;
      uv[t + 1] = 1 - j / SCALP_ROWS;
    }
  }

  const index: number[] = [];
  for (let i = 0; i < SCALP_COLUMNS; i++) {
    for (let j = 0; j < SCALP_ROWS; j++) {
      // The last column wraps onto the first rather than onto a copy of it. A copy is
      // two vertices in one place, each averaging only its own side into a normal, and
      // that is a lit crease down the back of every head in the shop.
      const a = i * rows + j;
      const b = ((i + 1) % SCALP_COLUMNS) * rows + j;
      // Wound so the front faces point OUT. Backfaces are culled, and a shell
      // inside out is a hairstyle you can see the player's skull through.
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  SCALP_GEOMETRY.set(key, geometry);
  return geometry;
}

/**
 * One swept bundle's mesh.
 *
 * Cached at module scope on the bundle's own vertices for the same two reasons
 * SCALP_GEOMETRY is: `HairPiece` is hook-free, and a fresh BufferGeometry per render
 * would leak a GPU buffer every time an outfit changed.
 *
 * As with the scalp, nothing here decides any shape - every vertex arrives from
 * constants/hairRibbon.ts by way of `buildHairLayout`, which is what keeps the drawn
 * mesh and the audited layout the same object seen twice.
 */
const RIBBON_GEOMETRY = new Map<string, THREE.BufferGeometry>();
/** One index buffer for every bundle in the shop - the topology never varies. */
const RIBBON_INDEX = ribbonIndices();

function ribbonGeometry(part: HairRibbonPart): THREE.BufferGeometry {
  // Keyed on the vertices themselves rather than on the style, because a bundle is
  // solved per tier, per slot and per hat, and two heads that agree on all of those
  // really are drawing the same surface.
  //
  // ALL of them, not the two ends. Under a hat the root is pressed onto the same point for
  // every hat and the tip is not pressed at all, so a key made of the ends alone handed the
  // 毛帽 the 草帽's bundle - whose release starts 7mm higher - and the hair came through.
  let hash = 2166136261;
  for (const p of part.positions) {
    for (const v of p) hash = Math.imul(hash ^ Math.round(v * 1e5), 16777619);
  }
  const key = `${part.positions.length}|${hash >>> 0}|${part.positions[0]?.join()}`;
  const cached = RIBBON_GEOMETRY.get(key);
  if (cached) return cached;

  const position = new Float32Array(part.positions.length * 3);
  const uv = new Float32Array(part.positions.length * 2);
  part.positions.forEach((p, i) => {
    position[i * 3] = p[0];
    position[i * 3 + 1] = p[1];
    position[i * 3 + 2] = p[2];
    uv[i * 2] = part.uvs[i][0];
    uv[i * 2 + 1] = part.uvs[i][1];
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(RIBBON_INDEX);
  geometry.computeVertexNormals();
  RIBBON_GEOMETRY.set(key, geometry);
  return geometry;
}

function LockGeometry({ part }: { part: HairLockPart }) {
  const [radius, length] = part.args;
  if (part.tip === undefined) return <capsuleGeometry args={part.args} />;
  return <cylinderGeometry args={[radius, radius * part.tip, length, 12, 1]} />;
}

export function HairPiece({
  spec,
  hat,
  swayRef,
}: {
  spec: HairSpec | null;
  /**
   * WHICH hat, not whether there is one, because the answer is different per hat: the
   * hair comes out from under 貝雷帽's tilted band at a different height on each side
   * of the head. See {@link HAT_BRIM}.
   */
  hat: HatKind | null;
  swayRef: React.RefObject<THREE.Group | null>;
}) {
  const layout = spec ? buildHairLayout(spec, { hat: hat ? HAT_BRIM[hat] : null }) : null;
  if (!layout) return null;

  const { color } = layout;

  return (
    <group>
      {/* Welded to the skull. Kept outside the sway group on purpose: swinging the
          scalp would slide the hairline off the face during a walk cycle. */}
      {layout.scalp && (
        /* DoubleSide, like the curtain below and for the same reason: the shell is an
           open surface, and a single-sided open surface can be LOOKED THROUGH. Its rim
           dives into the skull, so the strip where it turns in stands almost edge-on to
           the skin; cull that strip and the hairline drops out of the picture for the
           few degrees of camera rotation that cross its plane, which reads as the hair
           coming unstuck from the head and back again as the character turns. Drawing
           both faces costs one more fill of a surface that is mostly hidden behind the
           head anyway, and no angle can make it disappear.

           The shell is the only piece that asks for `breakup`: it is the one surface
           big enough for the highlight to cross as a continuous ring. It also shades
           the other way up - see `flip`: its dark end is the tucked rim, not the
           crown, which is the most exposed surface on the head. */
        <mesh
          geometry={scalpGeometry(layout.scalp)}
          material={hairMaterial({
            color,
            roughness: 0.85,
            side: THREE.DoubleSide,
            breakup: 1,
            flip: true,
            bands: SCALP_BANDS,
          })}
          castShadow
        />
      )}

      {/* Each bang lives inside a yawed slot, so +Z is always "away from the face"
          and no piece needs a hand-picked x/z pair. */}
      {layout.fringe.map(bang => (
        <group key={bang.key} rotation={[0, bang.yaw, 0]}>
          <mesh
            position={bang.position}
            rotation={bang.rotation}
            material={hairMaterial({
              color,
              roughness: 0.85,
              span: bang.span,
              rim: 0.4,
              tipShade: FRINGE_TIP_SHADE,
            })}
          >
            <LockGeometry part={bang} />
          </mesh>
        </group>
      ))}

      {/* The bangs under a hat: thin swept sheets pushed flat by the brim, drawn with the
          bangs' own shading. Outside the sway group - the hat is holding them. */}
      {layout.fringeSheets.map(sheet => (
        <mesh
          key={sheet.key}
          geometry={ribbonGeometry(sheet)}
          material={hairMaterial({ color, roughness: 0.85, rim: 0.4, tipShade: FRINGE_TIP_SHADE })}
        />
      ))}

      {/* 美式前刺. Same yaw-slot trick as the bangs, so a spike's own +Z is "forward
          at its angle" and the forward rake is one rotation instead of a solved
          x/z pair. Outside the sway group: wax does not swing. */}
      {layout.spikes.map(spike => (
        <group key={spike.key} rotation={[0, spike.yaw, 0]}>
          {/* `flip`, because a cone's apex is its +Y: the spike's ROOT is the base,
              which is the one place in the hair where uv.y already runs the way the
              shading wants it. */}
          <mesh
            position={spike.position}
            rotation={spike.rotation}
            material={hairMaterial({ color, roughness: 0.7, flip: true })}
            castShadow
          >
            <coneGeometry args={spike.args} />
          </mesh>
        </group>
      ))}

      {/* 渣男燙's twisted bundles. Same yaw-slot trick as the bangs and the spikes,
          which is what lets a bundle be raked along the skull's tangent with one
          rotation. Outside the sway group: a set perm holds its shape. */}
      {layout.perm.map(bundle => (
        <group key={bundle.key} rotation={[0, bundle.yaw, 0]}>
          <mesh
            position={bundle.position}
            rotation={bundle.rotation}
            material={hairMaterial({ color, roughness: 0.9, span: bundle.span, rim: 0.3 })}
            castShadow
          >
            <capsuleGeometry args={bundle.args} />
          </mesh>
        </group>
      ))}

      {layout.crest && (
        <>
          <mesh
            position={layout.crest.blade.position}
            material={hairMaterial({
              color,
              roughness: 0.8,
              emissive: layout.crest.emissive,
              emissiveIntensity: 0.2,
            })}
            castShadow
          >
            <boxGeometry args={layout.crest.blade.args} />
          </mesh>
          {layout.crest.spikes.map(spike => (
            <mesh
              key={spike.key}
              position={spike.position}
              material={hairMaterial({ color, roughness: 0.8, flip: true })}
            >
              <coneGeometry args={spike.args} />
            </mesh>
          ))}
        </>
      )}

      {/* Only the hanging pieces follow through. */}
      <group ref={layout.sway ? swayRef : undefined}>
        {layout.curtain && (
          <mesh
            position={[0, layout.curtain.y, 0]}
            material={hairMaterial({
              color,
              roughness: 0.85,
              side: THREE.DoubleSide,
              bands: HANG_BANDS,
              rim: 0.5,
              tipShade: HANG_TIP_SHADE * 0.7,
            })}
            castShadow
          >
            <cylinderGeometry args={layout.curtain.args} />
          </mesh>
        )}

        {/* The bundle-built back. One continuous surface each, root to tip, so
            there is no hem to come apart and nothing bolted onto anything. */}
        {layout.ribbons.map(ribbon => (
          <mesh
            key={ribbon.key}
            geometry={ribbonGeometry(ribbon)}
            material={hairMaterial({
              color,
              roughness: 0.85,
              bands: HANG_BANDS,
              rim: 0.35,
              tipShade: HANG_TIP_SHADE,
            })}
            castShadow
          />
        ))}

        {/* Locks and the strand relief lying on top of them. A tinted piece is a
            strand line: it is drawn in a shade DERIVED from the style's own colour
            rather than an authored one, and slightly glossier, so it catches light
            where the mass around it does not. That contrast is the whole point -
            painted in the base colour these lines are geometry nobody can see. */}
        {layout.locks.map(lock => (
          <group key={lock.key} rotation={[0, lock.yaw, 0]}>
            <mesh
              position={lock.position}
              rotation={lock.rotation}
              material={hairMaterial({
                color: lock.tint ? shadeHairColor(color, lock.tint) : color,
                roughness: lock.tint ? 0.55 : 0.85,
                // A segment of a wave or a hook shades as its own share of the
                // parent strand, so the ramp and the bands cross the seams.
                span: lock.span,
                // The hem. See HANG_TIP_SHADE and the `rim` option for why these
                // two numbers are what stops the ends reading as a picket fence.
                bands: HANG_BANDS,
                rim: 0.12,
                tipShade: HANG_TIP_SHADE,
              })}
            >
              <LockGeometry part={lock} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * Necklaces.
 *
 * These used to be one flat torus ringed around the neck with the pendant parented *inside*
 * that torus. The torus is tilted ~78 degrees about X, so the pendant's local -Y mapped to
 * roughly -Z - backwards into the chest - instead of down. The pendant was therefore buried
 * in the torso on every item, and the only thing left to tell the four lengths apart was a
 * torus radius that varied by 0.015. They all read as the same choked gold hoop.
 *
 * The strand is now a real drape: a closed curve that rides the nape and dips down the front
 * of the chest, so length actually shows. Each item then differs on four axes at once -
 * how far it dips, its metal, whether it is a chain or a bead strand, and its pendant.
 *
 * All coordinates are torso-local (the torso capsule is centred on its own origin).
 */

/** Where the strand crosses the nape. Low enough to clear the chibi head sphere. */
const STRAND_NAPE_Y = 0.085;
/** Torso capsule: half-height of the straight section, and the radius of the thickest shirt. */
const TORSO_STRAIGHT_HALF = 0.04;
const TORSO_DRESSED_R = 0.145;
/** Gap that keeps the strand riding on top of clothing rather than sinking into it. */
const STRAND_CLEARANCE = 0.008;
const PEARL_COUNT = 30;

/** How far off the torso axis the strand sits at height `y`, following the capsule's taper. */
function strandRadius(y: number) {
  const beyond = Math.max(0, Math.abs(y) - TORSO_STRAIGHT_HALF);
  return Math.sqrt(Math.max(TORSO_DRESSED_R * TORSO_DRESSED_R - beyond * beyond, 0.0004)) + STRAND_CLEARANCE;
}

/**
 * One closed loop of strand. theta = 0 is the centre of the chest, +-PI the nape. The cosine
 * drape is raised to a power below 1 so the strand leaves the shoulders quickly and spends
 * most of its length dipping down the front, which is how a hung chain actually falls.
 */
function buildStrandPoints(bottomY: number, samples = 56) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * Math.PI * 2 - Math.PI;
    const climb = Math.pow((1 - Math.cos(theta)) / 2, 0.65);
    const y = bottomY + (STRAND_NAPE_Y - bottomY) * climb;
    const r = strandRadius(y);
    points.push(new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r));
  }
  return points;
}

type NecklaceSpec = {
  /** Torso-local Y of the lowest point of the drape - the item's defining measurement. */
  bottomY: number;
  metal: string;
  metalness: number;
  roughness: number;
  /** Tube radius for a chain, largest bead radius for a strand of pearls. */
  gauge: number;
  strand: 'chain' | 'pearls';
  /** Accent beads threaded onto the strand, given as curve parameters (0.5 is centre front). */
  stations: number[];
  pendant: 'solitaire' | 'heart' | 'bar' | 'teardrop';
};

/**
 * `bottomY` is the strand's own low point; the pendant then hangs 0.06-0.08 BELOW that
 * (see NecklacePendant - the bail offsets are tuned so the ring closes around the tube,
 * so that drop is structural and not free to shrink). Read the two together, because the
 * pendant tip is what the eye actually reads as "how long is this necklace".
 *
 * The real-world lengths in the comments below are the FICTION, not the geometry. Taken
 * literally they put the opera rope's sapphire at -0.174 against a torso whose underside
 * is -0.175 - i.e. exactly at the waist - and the matinee 83% of the way there. On a chibi
 * with a two-heads-tall build there is no room for a true 70-85cm rope: the torso is only
 * 0.235 tall from neck to waist, so a faithful scale spends the entire body on one item.
 *
 * So the four are compressed into the upper chest and differentiate on metal, gauge,
 * strand type, stations and pendant instead - length still ORDERS them, it just no longer
 * carries the whole job alone. Keep every bottomY below STRAND_NAPE_Y or the drape stops
 * dipping and flattens into a plain ring.
 */
const NECKLACE_SPECS: Record<string, NecklaceSpec> = {
  // 40cm - rides the collarbone, so it barely dips at all. Fine silver, one small stone.
  'neck-choker': {
    bottomY: 0.054, metal: '#e5e7eb', metalness: 0.95, roughness: 0.15,
    gauge: 0.0055, strand: 'chain', stations: [], pendant: 'solitaire',
  },
  // 45-50cm - the classic V just below the collarbone. Yellow gold, rose heart.
  'neck-princess': {
    bottomY: 0.046, metal: '#fbbf24', metalness: 0.9, roughness: 0.2,
    gauge: 0.0068, strand: 'chain', stations: [], pendant: 'heart',
  },
  // 50-60cm - down to mid chest. Rose gold station chain, formal bar pendant.
  'neck-matinee': {
    bottomY: 0.040, metal: '#dd8f7e', metalness: 0.9, roughness: 0.25,
    gauge: 0.0062, strand: 'chain', stations: [0.24, 0.36, 0.64, 0.76], pendant: 'bar',
  },
  // 70-85cm - the long rope. Graduated pearls and a sapphire drop; nothing else looks like it.
  'neck-opera': {
    bottomY: 0.032, metal: '#f7f3ea', metalness: 0.15, roughness: 0.25,
    gauge: 0.0115, strand: 'pearls', stations: [], pendant: 'teardrop',
  },
};

/** Hangs from the lowest point of the strand, so its own origin is that point. */
function NecklacePendant({ kind, metal }: { kind: NecklaceSpec['pendant']; metal: string }) {
  if (kind === 'solitaire') {
    return (
      <group>
        <mesh position={[0, -0.011, 0]}>
          <torusGeometry args={[0.008, 0.0025, 6, 12]} />
          <meshStandardMaterial color={metal} metalness={0.95} roughness={0.15} />
        </mesh>
        <mesh position={[0, -0.034, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1, 1.3, 1]}>
          <octahedronGeometry args={[0.023, 0]} />
          <meshStandardMaterial color="#e0f2fe" metalness={0.25} roughness={0.05} emissive="#7dd3fc" emissiveIntensity={0.45} />
        </mesh>
      </group>
    );
  }

  if (kind === 'heart') {
    // Two lobes over a downward cone, flattened in Z so it reads as a cut pendant.
    return (
      <group position={[0, -0.042, 0]} scale={[1, 1, 0.55]}>
        {[-0.018, 0.018].map(x => (
          <mesh key={x} position={[x, 0.015, 0]}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <meshStandardMaterial color="#fb7185" metalness={0.3} roughness={0.15} emissive="#f43f5e" emissiveIntensity={0.25} />
          </mesh>
        ))}
        <mesh position={[0, -0.014, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.034, 0.056, 14]} />
          <meshStandardMaterial color="#fb7185" metalness={0.3} roughness={0.15} emissive="#f43f5e" emissiveIntensity={0.25} />
        </mesh>
      </group>
    );
  }

  if (kind === 'bar') {
    return (
      <group position={[0, -0.042, 0]}>
        <mesh position={[0, 0.040, 0]}>
          <torusGeometry args={[0.009, 0.0028, 6, 12]} />
          <meshStandardMaterial color={metal} metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh castShadow>
          <boxGeometry args={[0.030, 0.062, 0.014]} />
          <meshStandardMaterial color={metal} metalness={0.9} roughness={0.25} />
        </mesh>
        {/* Teal inlay down the face - the house accent, see DESIGN_SYSTEM.md. */}
        <mesh position={[0, 0, 0.009]}>
          <boxGeometry args={[0.012, 0.042, 0.004]} />
          <meshStandardMaterial color="#2A9D8F" metalness={0.35} roughness={0.2} emissive="#2A9D8F" emissiveIntensity={0.25} />
        </mesh>
      </group>
    );
  }

  // teardrop: a sphere capped by a cone that tapers up into a gold bail.
  return (
    <group position={[0, -0.046, 0]}>
      <mesh position={[0, 0.038, 0]}>
        <torusGeometry args={[0.010, 0.003, 6, 12]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.018, 0]}>
        <coneGeometry args={[0.024, 0.044, 14]} />
        <meshStandardMaterial color="#1e40af" metalness={0.4} roughness={0.1} emissive="#3b82f6" emissiveIntensity={0.3} />
      </mesh>
      <mesh castShadow>
        <sphereGeometry args={[0.028, 16, 16]} />
        <meshStandardMaterial color="#1e40af" metalness={0.4} roughness={0.1} emissive="#3b82f6" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

/** Mounts at the torso's own origin with no transform, so spec coordinates mean torso-local. */
export function JewelryNecklace({ spec }: { spec: NecklaceSpec }) {
  const { curve, pearls, stations, anchor } = useMemo(() => {
    const c = new THREE.CatmullRomCurve3(buildStrandPoints(spec.bottomY), true, 'catmullrom', 0.5);
    return {
      curve: c,
      // Graduated strand: the beads swell towards the front of the drape, as a real rope does.
      pearls: spec.strand === 'pearls'
        ? Array.from({ length: PEARL_COUNT }, (_, i) => {
            const u = i / PEARL_COUNT;
            return { at: c.getPoint(u), r: spec.gauge * (0.62 + 0.38 * (1 - Math.abs(u - 0.5) * 2)) };
          })
        : [],
      stations: spec.stations.map(u => c.getPoint(u)),
      anchor: new THREE.Vector3(0, spec.bottomY, strandRadius(spec.bottomY)),
    };
  }, [spec]);

  return (
    <group>
      {spec.strand === 'chain' ? (
        <mesh castShadow>
          <tubeGeometry args={[curve, 120, spec.gauge, 6, true]} />
          <meshStandardMaterial color={spec.metal} metalness={spec.metalness} roughness={spec.roughness} />
        </mesh>
      ) : (
        pearls.map((p, i) => (
          <mesh key={i} position={p.at} castShadow>
            <sphereGeometry args={[p.r, 10, 8]} />
            <meshStandardMaterial color={spec.metal} metalness={spec.metalness} roughness={spec.roughness} />
          </mesh>
        ))
      )}
      {stations.map((p, i) => (
        <mesh key={`station-${i}`} position={p}>
          <sphereGeometry args={[spec.gauge * 2.6, 10, 8]} />
          <meshStandardMaterial color={spec.metal} metalness={spec.metalness} roughness={spec.roughness} />
        </mesh>
      ))}
      <group position={anchor}>
        <NecklacePendant kind={spec.pendant} metal={spec.metal} />
      </group>
    </group>
  );
}

/**
 * Carving for the 部落面具, drawn on Paiwan/Rukai motifs: the 菱形 diamond chain of the
 * 百步蛇 across the brow and cheeks, hollow eyes ringed in ochre, a carved nose, bared
 * teeth flanked by 山豬牙 boar tusks, a feather crest, and 琉璃珠 glass beads hung at the chin.
 *
 * Mask-local coordinates: the plank is 0.286 x 0.347 x 0.12 centred on its origin, so the
 * carved face sits at z = 0.06 and the top edge at y = 0.1735.
 */
const MASK_WOOD = '#6f3410';
const MASK_RELIEF = '#8a4a1c';
const MASK_RED = '#b91c1c';
const MASK_CREAM = '#f5efe0';
const MASK_BLACK = '#1c1917';
const MASK_OCHRE = '#d9820b';
const MASK_BEAD = '#0d9488';

/** 百步蛇 diamond chain across the brow; alternating red and cream, as woven bands run. */
const MASK_BROW_DIAMONDS = [-0.088, -0.044, 0, 0.044, 0.088];
const MASK_CHEEK_MARKS = [
  { x: -0.112, y: -0.028, color: MASK_RED },
  { x: -0.112, y: -0.072, color: MASK_CREAM },
  { x: 0.112, y: -0.028, color: MASK_RED },
  { x: 0.112, y: -0.072, color: MASK_CREAM },
];
/** Chief's feather crest. Leans forward off the brow so it clears the wearer's own hair. */
const MASK_CREST = [
  { x: -0.088, tilt: 0.52, len: 0.088, color: MASK_RED },
  { x: -0.045, tilt: 0.27, len: 0.112, color: MASK_BLACK },
  { x: 0, tilt: 0, len: 0.128, color: MASK_CREAM },
  { x: 0.045, tilt: -0.27, len: 0.112, color: MASK_BLACK },
  { x: 0.088, tilt: -0.52, len: 0.088, color: MASK_RED },
];
const MASK_BEADS = [
  { x: -0.058, drop: 0.030, color: MASK_BEAD },
  { x: 0, drop: 0.044, color: MASK_OCHRE },
  { x: 0.058, drop: 0.030, color: MASK_BEAD },
];

/**
 * The plank's top edge once a hat is on: just under HAT_BROW_Y, which is where every hat's
 * lowest band starts. See the `underHat` note on TribalMask for why it has to move at all.
 */
const MASK_HATTED_TOP_Y = HAT_BROW_Y - 0.012;
/** The plank's own extents, so the hatted version can be derived rather than re-typed. */
const MASK_PLANK_H = 0.347;
const MASK_PLANK_BOTTOM_Y = -MASK_PLANK_H / 2;

/** The woven brow band's top edge, mask-local — it only survives a hat if the brim is above it. */
const MASK_BROW_BAND_TOP_Y = 0.112 + 0.062 / 2;

/**
 * `browOffset` is how far BELOW the hat socket the mask socket sits, in mask units. Zero on
 * legacy, where both hang off the skull centre. A model whose face is lower on the skull than
 * legacy's hangs the mask lower to keep its eye holes on the eyes (see AUTHORED_ATTACHMENTS),
 * which moves the hat's brow line UP in the mask's own space by exactly that much — so the
 * hatted plank has to reach further to meet it, or a strip of forehead shows under the brim.
 */
export function TribalMask({ underHat = false, browOffset = 0 }: { underHat?: boolean; browOffset?: number }) {
  /**
   * The carving is 0.347 tall on a head only 0.52 across, so its top edge reaches y 0.1735 —
   * a full 0.07 ABOVE the brow line every hat's lowest band sits on. Worn together, the two
   * do not stack, they intersect: 草帽's brim and 漁夫帽's brim both saw straight through the
   * woven brow band, and the feather crest came up through the felt of the other three.
   *
   * Under a hat the mask therefore ends at the brow and gives up the two pieces that live
   * above it — the crest and the brow band. Everything that makes it a FACE (eyes, nose,
   * teeth, tusks, cheek marks, the hanging 琉璃珠) is below the brow and is untouched, so
   * what the player gets is the mask worn under the hat rather than through it.
   */
  const hattedTop = Math.min(MASK_HATTED_TOP_Y + browOffset, MASK_PLANK_H / 2);
  const plankH = underHat ? hattedTop - MASK_PLANK_BOTTOM_Y : MASK_PLANK_H;
  const plankY = underHat ? (hattedTop + MASK_PLANK_BOTTOM_Y) / 2 : 0;
  const showBrowBand = !underHat || hattedTop >= MASK_BROW_BAND_TOP_Y;

  return (
    /* A GROUP, not the plank mesh with everything parented inside it: the carvings are
       positioned against the mask's own centreline, and the plank has to be free to shrink
       without dragging the face up with it. */
    <group position={[0, 0, 0.217]}>
      <mesh position={[0, plankY, 0]} castShadow>
        <boxGeometry args={[0.286, plankH, 0.12]} />
        <meshStandardMaterial color={MASK_WOOD} roughness={0.9} />
      </mesh>

      {/* Recessed face panel, so the carvings below read against a second wood tone. */}
      <mesh position={[0, -0.020, 0.058]}>
        <boxGeometry args={[0.235, 0.240, 0.006]} />
        <meshStandardMaterial color={MASK_RELIEF} roughness={0.9} />
      </mesh>

      {/* Woven brow band carrying the 百步蛇 diamond chain. */}
      {showBrowBand && (
        <>
          <mesh position={[0, 0.112, 0.061]}>
            <boxGeometry args={[0.250, 0.062, 0.008]} />
            <meshStandardMaterial color={MASK_BLACK} roughness={0.9} />
          </mesh>
          {MASK_BROW_DIAMONDS.map((x, i) => (
            <mesh key={`brow-${x}`} position={[x, 0.112, 0.067]} rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.030, 0.030, 0.005]} />
              <meshStandardMaterial color={i % 2 === 0 ? MASK_RED : MASK_CREAM} roughness={0.7} />
            </mesh>
          ))}
        </>
      )}

      {/* Hollow eyes ringed in ochre. */}
      {[-1, 1].map(side => (
        <group key={`eye-${side}`} position={[side * 0.064, 0.030, 0]}>
          <mesh position={[0, 0, 0.060]} scale={[1, 0.62, 0.16]}>
            <sphereGeometry args={[0.050, 16, 12]} />
            <meshStandardMaterial color={MASK_OCHRE} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.066]} scale={[1, 0.58, 0.16]}>
            <sphereGeometry args={[0.036, 16, 12]} />
            <meshStandardMaterial color={MASK_BLACK} roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Carved nose: a square prism turned 45 degrees so its edge is the ridge. */}
      <mesh position={[0, -0.014, 0.062]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.013, 0.026, 0.095, 4]} />
        <meshStandardMaterial color={MASK_WOOD} roughness={0.85} />
      </mesh>
      {[-0.014, 0.014].map(x => (
        <mesh key={`nostril-${x}`} position={[x, -0.054, 0.076]}>
          <sphereGeometry args={[0.007, 8, 8]} />
          <meshStandardMaterial color={MASK_BLACK} roughness={0.9} />
        </mesh>
      ))}

      {/* Bared teeth. */}
      <mesh position={[0, -0.100, 0.061]}>
        <boxGeometry args={[0.118, 0.040, 0.008]} />
        <meshStandardMaterial color={MASK_BLACK} roughness={0.9} />
      </mesh>
      {[-0.042, -0.014, 0.014, 0.042].map(x => (
        <mesh key={`tooth-${x}`} position={[x, -0.100, 0.066]}>
          <boxGeometry args={[0.020, 0.032, 0.004]} />
          <meshStandardMaterial color={MASK_CREAM} roughness={0.6} />
        </mesh>
      ))}

      {/* 山豬牙 - tusks sweeping up and outward from the corners of the mouth. */}
      {[-1, 1].map(side => (
        <group key={`tusk-${side}`} position={[side * 0.072, -0.108, 0.072]} rotation={[0.15, 0, -side * 0.55]}>
          <mesh position={[0, 0.040, 0]} castShadow>
            <coneGeometry args={[0.011, 0.080, 8]} />
            <meshStandardMaterial color="#f8f4e6" roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* 菱形紋 on the cheeks. */}
      {MASK_CHEEK_MARKS.map(mark => (
        <mesh key={`cheek-${mark.x}-${mark.y}`} position={[mark.x, mark.y, 0.058]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.026, 0.026, 0.005]} />
          <meshStandardMaterial color={mark.color} roughness={0.7} />
        </mesh>
      ))}

      {/* Feather crest on a bound headband. Comes off under a hat — see above. */}
      {!underHat && (
        <>
          <mesh position={[0, 0.166, 0.020]}>
            <boxGeometry args={[0.245, 0.030, 0.078]} />
            <meshStandardMaterial color={MASK_BLACK} roughness={0.9} />
          </mesh>
          {MASK_CREST.map(feather => (
            <group key={`feather-${feather.x}`} position={[feather.x, 0.168, 0.030]} rotation={[0.30, 0, feather.tilt]}>
              <mesh position={[0, feather.len / 2, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1, 1, 0.35]} castShadow>
                <coneGeometry args={[0.017, feather.len, 4]} />
                <meshStandardMaterial color={feather.color} roughness={0.85} />
              </mesh>
            </group>
          ))}
        </>
      )}

      {/* 琉璃珠 strung under the chin. */}
      {MASK_BEADS.map(bead => (
        <group key={`bead-${bead.x}`} position={[bead.x, -0.1735, 0.030]}>
          <mesh position={[0, -bead.drop / 2, 0]}>
            <cylinderGeometry args={[0.0025, 0.0025, bead.drop, 6]} />
            <meshStandardMaterial color={MASK_BLACK} roughness={0.9} />
          </mesh>
          <mesh position={[0, -bead.drop - 0.012, 0]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial color={bead.color} roughness={0.25} metalness={0.1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}



// ===========================================================================
// WEARABLE COMPONENTS
//
// One component per socket, each mounting at its anchor with no transform of its
// own — so the offsets inside are anchor-local and the MODEL decides where the
// anchor is. That is the whole decoupling: a hat no longer knows it is on the
// legacy head, it knows it is on `attachments.hat`.
// ===========================================================================

/**
 * WHERE A WREATH GOES ONCE A HAT IS ON — a correction applied to the `crown` socket, not a
 * second copy of it.
 *
 * `crown` and `hat` are separate sockets precisely so the two can be owned at once (see
 * CharacterAttachments), but they are not separate SPACE: every hat's lowest band sits at
 * HAT_BROW_Y with a radius of about 0.25, and 森林花冠's vine rings the skull at y 0.14 with
 * a radius of 0.219. That is inside the band on all five hats. What the player got was a
 * ring buried in the felt with its three blooms — which ride proud of the vine — stabbing
 * back out through it, or, under 漁夫帽's deep crown, an ornament they had bought and could
 * not see at all.
 *
 * So a hatted wreath rings the HAT instead of the head: the same ornament, moved up and
 * widened onto the band the hat itself wears, which is where a garland goes on a real
 * straw hat anyway. Each entry lifts the vine to that hat's band height and scales it to
 * that band's radius — the numbers are read off the geometry below, so a hat that is
 * re-fitted has to bring its ring with it.
 *
 * 貝雷帽 is the one that carries a rotation: its band is tilted with the whole beret, and
 * an upright ring through a tilted band is the same clash one axis over. Matching the
 * beret's own euler puts the vine ON the band at every angle, because `Attachment` applies
 * the rotation to the ornament's offset as well as to the ornament.
 */
/**
 * Where each hat wants the ring, in that hat's own band: a height and a radius, read off the
 * geometry below rather than converted by hand into an offset. A hat that gets re-fitted has
 * to bring these two numbers with it, and nothing else.
 */
/**
 * Where each hat stops hiding the head, so the HAIR knows where to come out from under it.
 *
 * The other half of the fix described in constants/hair.ts's HAIR UNDER A HAT note. The hair
 * no longer disappears when a hat goes on - it is pressed onto the skull under the hat and
 * released below the hat's own lowest ring - and this is the only thing that has to be said
 * per hat for that to land in the right place. Read off the geometry below, exactly as
 * {@link HAT_CROWN_BAND} is, so a hat that is re-fitted brings this number with it:
 *
 *   草帽    brim disc, group y 0.12 + half its 0.026 thickness -> 0.107.
 *   漁夫帽  brim cone, group y 0.13 - 0.01 - half its 0.04 -> 0.100.
 *   毛帽    the cuff's bottom rim, which IS HAT_BROW_Y by construction.
 *   平板帽  the headband's bottom rim, likewise.
 *   貝雷帽  the band's bottom CIRCLE, which is not level: the beret is worn tilted, so the
 *           circle (r 0.2437 at its own y 0.118) swings between y 0.038 and 0.187 once the
 *           hat's [0.08, 0, 0.3] euler has been applied to it. `leanX`/`leanZ` are that
 *           circle pushed through the same rotation - which is why a tilted beret gets a
 *           hairline that tilts with it rather than a bald crescent on the high side.
 */
export const HAT_BRIM: Record<HatKind, HatBrim> = {
  straw: { y: 0.107 },
  bucket: { y: 0.100 },
  beanie: { y: HAT_BROW_Y },
  snapback: { y: HAT_BROW_Y },
  beret: { y: 0.1124, leanX: 0.0720, leanZ: -0.0186 },
};

const HAT_CROWN_BAND: Record<HatKind, { y: number; radius: number; tilt?: readonly [number, number, number] }> = {
  // 草帽: on the ribbon, above the brim and outside the crown cone (r 0.2489 at that height).
  straw: { y: 0.148, radius: 0.272 },
  // 漁夫帽: around the bucket crown (r 0.2764 at 0.185), clear of the brim below it.
  bucket: { y: 0.185, radius: 0.288 },
  // 貝雷帽: the headband's own centre — and the beret's own euler, so the ring tilts with it.
  beret: { y: 0.153, radius: 0.239, tilt: [0.08, 0, 0.3] },
  // 毛帽: on the folded cuff's crease (r 0.2585), where a knitted hat's band is.
  beanie: { y: 0.178, radius: 0.262 },
  // 平板帽: around the headband (r 0.252-0.256), above the brim's top edge at 0.126.
  snapback: { y: 0.140, radius: 0.266 },
};

/**
 * Turns "the ring belongs at this height, this far out" into the socket correction that puts
 * it there.
 *
 * A crown ornament is scaled about the head's centre, so widening it also RAISES it — the two
 * cannot be chosen separately. Scale therefore comes from the radius, and the offset is
 * whatever is left over to put the band back at the height asked for.
 */
function crownRingAt(
  y: number,
  radius: number,
  rotation?: readonly [number, number, number],
): AttachmentPoint {
  const scale = radius / CROWN_RING.radius;
  return { position: [0, y - CROWN_RING.y * scale, 0], rotation, scale };
}

export const HAT_CROWN_RING: Record<HatKind, AttachmentPoint> = Object.fromEntries(
  Object.entries(HAT_CROWN_BAND).map(([kind, band]) => [kind, crownRingAt(band.y, band.radius, band.tilt)]),
) as Record<HatKind, AttachmentPoint>;

/**
 * The same correction for a HEAD OF HAIR, which is the other thing that can be outside the
 * skull when a wreath arrives — and the more common one, because a hat is optional and a
 * hairstyle is what most players are wearing.
 *
 * Eight of the nine styles put a scalp dome on the head, standing `bulk` off the skull (up to
 * 0.042 on 渣男燙's 錫紙燙), so a ring authored ON the sphere is a ring INSIDE the hair: what
 * the player saw for their 680 coins was three blooms poking out of a wig and no vine at all.
 * The ring is therefore re-aimed at the hair's own shell, per style, so a thin 吋頭 does not
 * get a wreath floating a centimetre off it just because a perm needs the room.
 *
 * 龐克髮型 is the exception and needs no entry: `cap: false`, no dome, so the skull IS the
 * outermost surface and the socket's own promise still holds.
 */
const HAIR_RING_CLEARANCE = 0.008;
/** The band constants/hair.ts clamps `bulk` into. Restated because it does not export them. */
const HAIR_BULK_MIN = 0.008;
const HAIR_BULK_MAX = 0.05;

export function hairCrownRing(spec: HairSpec): AttachmentPoint | null {
  if (!spec.cap) return null;
  const bulk = Math.min(Math.max(spec.bulk ?? HEAD_ANCHOR.shell, HAIR_BULK_MIN), HAIR_BULK_MAX);
  const shellR = HEAD_ANCHOR.radius + bulk;
  // The dome is a sphere of that radius about HEAD_ANCHOR.originY, so this is its own
  // cross-section at the ring's height — the same derivation the bare skull's 0.219 came from.
  const dy = CROWN_RING.y - HEAD_ANCHOR.originY;
  const onHair = Math.sqrt(Math.max(shellR * shellR - dy * dy, 0)) + HAIR_RING_CLEARANCE;
  if (onHair <= CROWN_RING.radius) return null;
  return crownRingAt(CROWN_RING.y, onHair);
}

/**
 * The same correction again, for the `hairPin` socket — 「星星泡泡髮飾／蝴蝶髮夾會被頭髮遮住」.
 *
 * It is the identical defect the wreath had, one socket over, and it was never fixed there
 * because the two sockets were tuned separately: `hairPin` is documented as sitting ON the
 * SKULL's surface (|(0.215, 0.075, 0.12)| = 0.257 against a 0.26 sphere — 「an ornament rests on
 * the head with a hair's clearance」). That promise is only true on a BARE head. Every capped
 * style puts a scalp dome at HEAD_ANCHOR.radius + `bulk` — 0.28 at the default and up to 0.302
 * on 渣男燙 — so a pin authored on the skull is a pin authored INSIDE the hair, and the player
 * sees a hairpin only when they take their hairstyle off. Which is not a thing they can do.
 *
 * So the pin is pushed out along its own direction until it is on the HAIR's surface, per style,
 * exactly as {@link hairCrownRing} does for the wreath. Nothing here knows which ornament it is
 * moving: every present and future `hairPin` cosmetic (星星髮飾, 泡泡髮飾, 蝴蝶髮夾, …) inherits
 * it, which is the point — the bug was in the socket, not in three ornaments.
 *
 * 龐克髮型 needs no entry and gets none: `cap: false`, no dome, so the skull is still the
 * outermost surface and the socket's own promise holds.
 *
 * A HAT no longer lands here unchanged, and that is a consequence of the hair fix rather than
 * a second decision: a hat used to delete the scalp dome, so a pin under the brim really was
 * resting on bare skull. It now PRESSES the dome instead (constants/hair.ts, HAIR UNDER A HAT),
 * and the pin socket sits at y=0.075 — below every brim, which is exactly where the shell is
 * springing back out to full volume — so without this the hat would have put the hairpins back
 * inside the hair they were dug out of. The pin therefore follows the same release ramp the
 * shell does, which is what `pressedShellR` is for.
 *
 * The socket's own `scale` carries the model: v2's head sockets are legacy's × 0.81, and scaling
 * the anchor by the same number keeps this one derivation correct for both heads rather than
 * needing a second table of numbers per model.
 */
const HAIR_PIN_CLEARANCE = 0.012;

export function hairPinOnHair(
  spec: HairSpec | null,
  point: AttachmentPoint,
  hat: HatKind | null,
): AttachmentPoint {
  if (!spec?.cap) return point;
  const s = point.scale ?? 1;
  const bulk = Math.min(Math.max(spec.bulk ?? HEAD_ANCHOR.shell, HAIR_BULK_MIN), HAIR_BULK_MAX);
  const [px, py, pz] = point.position;
  // The dome is a sphere of this radius about HEAD_ANCHOR.originY, both in the model's own
  // units — pressed in toward the skull where a hat is squeezing it. All three of the radii
  // this scales are in the model's units, so the socket's own scale carries through unchanged.
  const free = HEAD_ANCHOR.radius + bulk;
  const brim = hat ? HAT_BRIM[hat] : null;
  const shellR =
    (brim ? pressedShellR(free, py / s, hatHairlineY(brim, Math.atan2(px, pz))) : free) * s;
  const originY = HEAD_ANCHOR.originY * s;
  const dy = py - originY;
  const r = Math.hypot(px, dy, pz);
  const target = shellR + HAIR_PIN_CLEARANCE * s;
  // Already outside the hair (a future socket authored proud of it) — leave it exactly alone.
  if (r < 1e-6 || target <= r) return point;
  const k = target / r;
  return { ...point, position: [px * k, originY + dy * k, pz * k] };
}

/** Mounts at the `hat` anchor. Head-local geometry — see the HAT FITTING note above. */
export function LegacyHat({ kind }: { kind: HatKind }) {
  return (
    <>
  {kind === 'straw' && (
    <group position={[0, 0.12, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.45, 0.45, 0.026, 32]} />
        <meshStandardMaterial color={HAT_PALETTES['item-5'].body} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.10, 0]} castShadow>
        <cylinderGeometry args={[0.19, 0.26, 0.22, 32]} />
        <meshStandardMaterial color={HAT_PALETTES['item-5'].body} roughness={0.9} />
      </mesh>
      {/* Ribbon Accent — a band lying ON the brim, so its top face is coplanar with the
          brim's by design. DECAL_DEPTH_BIAS is what settles that, not pushing it up. */}
      <mesh position={[0, 0.017, 0]}>
        <cylinderGeometry args={[0.262, 0.262, 0.026, 32]} />
        <meshStandardMaterial color={HAT_PALETTES['item-5'].accent} roughness={0.7} {...DECAL_DEPTH_BIAS} />
      </mesh>
    </group>
  )}
  {kind === 'bucket' && (
    <group position={[0, 0.13, 0]}>
      {/* Crown of the bucket hat */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.27, 0.28, 0.18, 32]} />
        <meshStandardMaterial color={HAT_PALETTES['hat-bucket'].body} roughness={0.8} />
      </mesh>
      {/* Brim of the bucket hat */}
      <mesh position={[0, -0.01, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.28, 0.04, 32, 1, true]} />
        <meshStandardMaterial color={HAT_PALETTES['hat-bucket'].body} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  )}
  {kind === 'beret' && (
    /* A beret is a disc TOO BIG for the head it is pinned to, worn tilted. The
       overhang is the entire identity - the old version had none, because a
       0.29 hemisphere on a 0.26 head is just a skullcap, and tilting a skullcap
       only exposes the head on the high side and buries it on the low side.
       Rotation only, about the head centre: see the HAT FITTING note above. */
    <group rotation={[0.08, 0, 0.3]}>
      {/* Headband. A truncated cone rather than a cylinder so it follows the
          skull's taper and stays snug the whole way up.

          The tilt is kept at its full 0.3 - it is the look, and it is not what
          was covering the eye. What was covering it is that the band sat at
          y 0.035..0.105 while the tilt swings one eye UP to latitude 0.082 in
          this frame, putting that eye inside the band's own span. So the band
          rises to 0.118..0.188, clearing the raised eye (0.082 + 0.036) with a
          brow's gap, and takes itself in to bandRadiusAt(0.118) to stay on the
          head at the narrower latitude it now grips. Its bottom rim is
          sqrt(0.118^2 + 0.244^2) = 0.271 > HEAD_R, so it still cannot clip. */}
      <mesh position={[0, BERET_BAND_BOTTOM_Y + 0.035, 0]} castShadow>
        <cylinderGeometry args={[bandRadiusAt(BERET_BAND_BOTTOM_Y) - 0.018, bandRadiusAt(BERET_BAND_BOTTOM_Y), 0.07, 32]} />
        <meshStandardMaterial color={BERET_BAND} roughness={0.9} />
      </mesh>
      {/* The disc: a flattened ellipsoid, closed, so there is no hollow underside
          to see into. It rides up with the band, keeping the same 0.085 gap to it,
          which is what preserves the join: its lower half still narrows and tucks
          up INSIDE the band rather than butting against it. Its width is unchanged
          at 0.335, so taking the band in actually WIDENS the cantilever that is the
          beret's whole identity, from 0.085 to 0.109. */}
      <mesh position={[0, 0.238, 0]} scale={[1, 0.44, 1]} castShadow>
        <sphereGeometry args={[0.335, 40, 24]} />
        <meshStandardMaterial color={BERET.body} roughness={0.88} />
      </mesh>
      {/* The knot at the crown. The old 0.01-radius stalk was thinner than a hair
          strand and vanished at any real camera distance. Held at the disc's own
          offset (+0.141) so it rides with it. */}
      <mesh position={[0, 0.379, 0]} scale={[1, 0.62, 1]} castShadow>
        <sphereGeometry args={[0.028, 14, 14]} />
        <meshStandardMaterial color={BERET_BAND} roughness={0.9} />
      </mesh>
    </group>
  )}
  {kind === 'beanie' && (
    /* Rebuilt against the shop icon, which is what the player was promised: a knit
       dome TALLER than a hemisphere, carrying vertical ribs, sitting in a chunky
       folded cuff, under a big pompom. The old model had none of those four - it
       was a bare hemisphere with a wire-thin ring part way up it and a pompom sunk
       inside its own crown, which is why it looked nothing like the thumbnail. */
    <group>
      {/* Dome and ribs share one Y stretch, so the ribs stay parallel to the knit
          however the dome is proportioned. 1.32 is what makes it a beanie rather
          than a swim cap: the icon's dome is 26 tall to 29 wide, nearly square,
          where a plain hemisphere would be half as tall as it is wide. */}
      <group position={[0, 0.12, 0]} scale={[1, 1.18, 1]}>
        <mesh castShadow>
          <sphereGeometry args={[0.246, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={BEANIE.body} roughness={0.95} />
        </mesh>
        {/* Each rib is a narrow wedge of a very slightly larger sphere, so it
            curves with the dome exactly instead of being a straight bar laid
            across a curved surface. */}
        {BEANIE_RIBS.map((phi, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.2495, 5, 16, phi, 0.17, 0.22, Math.PI / 2 - 0.22]} />
            <meshStandardMaterial color={BEANIE_RIB} roughness={0.95} />
          </mesh>
        ))}
      </group>
      {/* The folded cuff, at the BOTTOM where a cuff is, and thick enough to read
          as folded wool. The dome's open rim sits inside it, so the cuff is also
          what closes the hat off.

          This is the part that was worn through the eyes: at y -0.026..0.062 it
          spanned 88% of an eye that tops out at 0.071, and at r 0.272 against an
          eye only 0.248 from the axis it was not grazing them, it was passing
          through them. Its bottom now sits on HAT_BROW_Y and its radius comes from
          bandRadiusAt at that height - taking it in from 0.272 to 0.252, which is
          what keeps it ON the head after the lift rather than around it. */}
      <mesh position={[0, HAT_BROW_Y + 0.036, 0]} castShadow>
        <cylinderGeometry args={[bandRadiusAt(HAT_BROW_Y) + 0.004, bandRadiusAt(HAT_BROW_Y), 0.072, 32]} />
        <meshStandardMaterial color={BEANIE.trim} roughness={0.92} />
      </mesh>
      {/* The fold itself - the crease where the wool doubles back, at the cuff's
          top edge (0.10 + 0.072). */}
      <mesh position={[0, 0.172, 0]}>
        <cylinderGeometry args={[0.2585, 0.2585, 0.012, 32]} />
        <meshStandardMaterial color={BEANIE_FOLD} roughness={0.9} />
      </mesh>
      {/* Pompom, ON the crown: the dome tops out at 0.12 + 0.246*1.18 = 0.410 and
          this is centred at 0.465 with r 0.088, so it nestles in by 0.033 and
          covers the point where the ribs converge. */}
      <mesh position={[0, 0.465, 0]} castShadow>
        <sphereGeometry args={[0.088, 20, 20]} />
        <meshStandardMaterial color={BEANIE.accent} roughness={0.95} />
      </mesh>
    </group>
  )}
  {kind === 'snapback' && (
    /* Same failure as the beanie and the same fix: the crown was a hemisphere no
       wider than the skull perched at y 0.08, and the two parts that identify the
       hat - the flat brim and the snap strap - were floating in clear air beside
       it rather than fastened to anything. Everything here overlaps the headband. */
    <group>
      {/* Structured crown. Slightly stretched so it stands up like a panelled cap
          rather than lying flat like a helmet. */}
      <mesh position={[0, 0.115, 0]} scale={[1, 1.05, 1]} castShadow>
        <sphereGeometry args={[0.246, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={SNAPBACK.body} roughness={0.85} />
      </mesh>
      {/* Front panel seam, the other half of what makes a cap structured rather
          than soft. phi = PI/2 is +Z in three's sphere winding, i.e. the face. */}
      <mesh position={[0, 0.115, 0]} scale={[1, 1.05, 1]}>
        <sphereGeometry args={[0.2485, 4, 16, Math.PI / 2 - 0.055, 0.11, 0.14, Math.PI / 2 - 0.14]} />
        <meshStandardMaterial color={SNAPBACK_SEAM} roughness={0.85} />
      </mesh>
      {/* Headband. Closes the crown's open rim, and is the part the brim and the
          strap both attach INTO - which is the whole difference between a cap
          being worn and three separate objects near a head.

          It used to sit at y -0.029..0.026, i.e. across the lower third of both
          eyes. Its bottom is now on HAT_BROW_Y with its radius from bandRadiusAt
          there, and the crown, brim, button and strap are all placed off it, so
          the cap moves as one piece instead of the band lifting away from its
          own parts. */}
      <mesh position={[0, HAT_BROW_Y + 0.0275, 0]} castShadow>
        <cylinderGeometry args={[bandRadiusAt(HAT_BROW_Y) + 0.004, bandRadiusAt(HAT_BROW_Y), 0.055, 32]} />
        <meshStandardMaterial color={SNAPBACK.trim} roughness={0.85} />
      </mesh>
      {/* The flat brim. A disc, not a box: a disc gives the rounded front edge a
          brim actually has, and being a plain horizontal cylinder it is DEAD LEVEL
          by construction - 帽簷平直不彎曲, the thing the product description claims
          and the thing the old tilted box did not do. Its back half is swallowed by
          the headband and the head, so what shows is a slab emerging from under the
          band. It spans y 0.100..0.126, which is inside the band's span (0.100 up
          to 0.155) so the two genuinely intersect, and which puts it above the
          brow rather than across the face it used to hang over. */}
      <mesh position={[0, 0.113, 0.262]} castShadow>
        <cylinderGeometry args={[0.262, 0.262, 0.026, 40]} />
        <meshStandardMaterial color={SNAPBACK.trim} roughness={0.8} />
      </mesh>
      {/* Crown button, nestled into the crown's top (0.115 + 0.246*1.05 = 0.373). */}
      <mesh position={[0, 0.377, 0]} castShadow>
        <sphereGeometry args={[0.024, 12, 12]} />
        <meshStandardMaterial color={SNAPBACK.accent} roughness={0.8} />
      </mesh>
      {/* The snap strap the style is named for, straddling the back of the band at
          the band's own height and radius so it reads as fastened across it. */}
      <mesh position={[0, HAT_BROW_Y + 0.0275, -(bandRadiusAt(HAT_BROW_Y) + 0.004)]} castShadow>
        <boxGeometry args={[0.1, 0.052, 0.022]} />
        <meshStandardMaterial color={SNAPBACK.accent} roughness={0.9} />
      </mesh>
    </group>
  )}
    </>
  );
}

/** Mounts at the `face` anchor. */
export function LegacyGlasses() {
  return (
    <>
      <mesh position={[-0.104, 0, 0]}>
        <boxGeometry args={[0.147, 0.104, 0.026]} />
        <meshStandardMaterial color="#111" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0.104, 0, 0]}>
        <boxGeometry args={[0.147, 0.104, 0.026]} />
        <meshStandardMaterial color="#111" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.087, 0.013, 0.017]} />
        <meshStandardMaterial color="#111" />
      </mesh>
    </>
  );
}

/** The stud colours, keyed by kind rather than resolved through a six-deep ternary per ear. */
const EARRING_COLOR: Record<EarringKind, string> = {
  jewel: '#3b82f6',
  flower: '#f43f5e',
  pearl: '#ffffff',
  gold: '#fbbf24',
  coral: '#fb7185',
  star: '#fde68a',
};

/**
 * One stud. Mounts at the `ear` anchor, which the model mirrors to ±x — so this draws a
 * single ear rather than a hard-coded pair, and a model with differently-placed ears does
 * not need this file changed.
 */
export function LegacyEarring({ kind }: { kind: EarringKind }) {
  return (
    <mesh>
      <sphereGeometry args={[0.043, 8, 8]} />
      <meshStandardMaterial
        color={EARRING_COLOR[kind]}
        emissive={kind === 'jewel' ? '#3b82f6' : '#000000'}
        emissiveIntensity={0.5}
      />
    </mesh>
  );
}

/**
 * Grass Skirt. Drawn in legacy TORSO space, hung from the hips on a model that says where they
 * are (see LegacyTorsoWearables).
 *
 * It used to stop at y -0.12, which is ABOVE the torso capsule's own bottom (-0.175) and
 * above the hip joint the legs hang from. So it was not a skirt, it was a green band at
 * the waist — and whatever was worn with it hung out underneath: the captain's navy, the
 * jacket's olive hem rib, the swimsuit's rose, the grey stand-in shirt, all showing as a
 * strip of "underwear" below the grass. The hem now falls past the bottom of the torso,
 * so it covers the hem of every top instead of cutting each one in half.
 *
 * -0.205 is the choice: 0.03 below the capsule so nothing can peek under it on a lean,
 * and still 0.06 above the knee, so the legs read as legs. The flare (0.25 of rise) is
 * the original's, carried down the longer skirt, and its widest point stays well inside
 * the arms' swing.
 */
export const GRASS_SKIRT_WAIST_R = 0.155;

/** How much the grass flares per unit of length: legacy's 0.155 → 0.211 over 0.225. */
const GRASS_SKIRT_FLARE = (0.211 - GRASS_SKIRT_WAIST_R) / 0.225;

/**
 * Every argument defaults to legacy's skirt, which is what it draws with none given.
 *
 *   top / hem        where the waistband's top edge and the grass's hem are, in the mount's y.
 *   waistX / waistZ  the waist's half-width and half-depth. A body shallower than it is wide
 *                    gets an oval skirt, so it does not stand off the belly to clear the hips.
 */
export function GrassSkirt({
  top = 0.02,
  hem = -0.205,
  waistX = GRASS_SKIRT_WAIST_R,
  waistZ = GRASS_SKIRT_WAIST_R,
}: {
  top?: number;
  hem?: number;
  waistX?: number;
  waistZ?: number;
}) {
  const length = top - hem;
  // The grass is a unit cylinder squashed onto the waist oval; the flare is added in absolute
  // terms across the width so a narrow skirt spreads as much as a wide one.
  const flareX = 1 + (GRASS_SKIRT_FLARE * length) / waistX;

  // The waistband is a tube along the oval rather than a torus: a torus scaled to an oval would
  // scale its own thickness with it.
  const band = useMemo(() => {
    const points = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return new THREE.Vector3(Math.sin(a) * (waistX + 0.001), 0, Math.cos(a) * (waistZ + 0.001));
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 48, 0.015, 8, true);
  }, [waistX, waistZ]);

  return (
    <group>
      <mesh position={[0, top - length / 2, 0]} scale={[waistX, 1, waistZ]} castShadow>
        <cylinderGeometry args={[1, flareX, length, 32]} />
        <meshStandardMaterial color="#84cc16" roughness={0.9} />
      </mesh>
      {/* Straw Waistband */}
      <mesh position={[0, top - 0.01, 0]} geometry={band}>
        <meshStandardMaterial color="#ca8a04" roughness={0.9} />
      </mesh>
      {/* Hanging flower details on waistband, on the oval's front */}
      {[-0.08, 0, 0.08].map((x, idx) => (
        <mesh
          key={idx}
          position={[x, top - 0.03, waistZ * Math.sqrt(Math.max(0, 1 - (x / waistX) ** 2))]}
        >
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color={idx % 2 === 0 ? "#f43f5e" : "#eab308"} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Everything worn on the torso: the tops that predate OutfitModel, the swimsuit, the grass
 * skirt and both kinds of necklace. Mounts at the `torso` anchor.
 *
 * `withSkirt` is false only where the caller mounts the skirt itself — a model whose torso is
 * warped rather than scaled hangs it from the hips instead. See LegacyTorsoWearables.
 */
export function LegacyTorsoWear({ outfit, withSkirt = true }: { outfit: CharacterOutfit; withSkirt?: boolean }) {
  // Keyed by item id rather than name, so renaming an item in the shop cannot silently
  // drop a necklace back to the generic look. See NECKLACE_SPECS.
  const necklaceSpec = outfit.necklaceId
    ? NECKLACE_SPECS[outfit.necklaceId] ?? NECKLACE_SPECS['neck-princess']
    : null;

  return (
    <>
  {/* Layered Clothing Fits naturally directly on Torso, No floating, No clipping */}
  {outfit.hasFallbackShirt && (
    <group position={[0, 0, 0]}>
      {/* Shirt fitted precisely */}
      <mesh position={[0, 0, 0]}>
        <capsuleGeometry args={[LEGACY_WEARABLE_FIT.top.radius, LEGACY_WEARABLE_FIT.top.length, 4, 16]} />
        <meshStandardMaterial color="#718096" roughness={0.6} />
      </mesh>
    </group>
  )}
  {outfit.hasShirt && (
    <group position={[0, 0, 0]}>
      {/* Shirt fitted precisely */}
      <mesh position={[0, 0, 0]}>
        <capsuleGeometry args={[0.140, 0.08, 4, 16]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.6} />
      </mesh>
      {/* Soft decal symbol */}
      <mesh position={[0, 0, 0.14]} scale={[1, 1, 0.1]}>
         <sphereGeometry args={[0.035, 8, 8]} />
         <meshStandardMaterial color="#ffffff" opacity={0.4} transparent />
      </mesh>
      {/* Collar neckline detail */}
      <mesh position={[0, 0.053, 0]} rotation={[0.4, 0, 0]}>
        <torusGeometry args={[0.142, 0.015, 8, 32]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.5} />
      </mesh>
      {/* Folded Shirt Collar Lapels (open neck) */}
      <mesh position={[-0.04, 0.04, 0.13]} rotation={[0.4, 0.2, 0.4]}>
        <boxGeometry args={[0.035, 0.045, 0.01]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.6} />
      </mesh>
      <mesh position={[0.04, 0.04, 0.13]} rotation={[0.4, -0.2, -0.4]}>
        <boxGeometry args={[0.035, 0.045, 0.01]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.6} />
      </mesh>
      {/* Fine Chest Pocket */}
      <mesh position={[-0.05, 0.002, 0.128]}>
        <boxGeometry args={[0.032, 0.038, 0.012]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.6} />
      </mesh>
      {/* Palm Buttons */}
      {[0.015, -0.015].map((y, idx) => (
        <mesh key={idx} position={[0, y, 0.138]} rotation={[1.5, 0, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.004, 8]} />
          <meshStandardMaterial color="#eab308" roughness={0.5} />
        </mesh>
      ))}
    </group>
  )}
  {outfit.outfit && <OutfitModel type={outfit.outfit} />}
  {outfit.hasSwimsuit && (
    <group position={[0, 0, 0]}>
      <mesh position={[0, -0.04, 0]}>
        <cylinderGeometry args={[0.140, 0.140, 0.08, 32]} />
        <meshStandardMaterial color="#f43f5e" roughness={0.6} />
      </mesh>
      {/* Halter Top Straps & Design */}
      <mesh position={[-0.04, 0.03, 0.12]} rotation={[0.4, 0.2, 0.5]}>
        <boxGeometry args={[0.015, 0.08, 0.015]} />
        <meshStandardMaterial color="#f43f5e" roughness={0.6} />
      </mesh>
      <mesh position={[0.04, 0.03, 0.12]} rotation={[0.4, -0.2, -0.5]}>
        <boxGeometry args={[0.015, 0.08, 0.015]} />
        <meshStandardMaterial color="#f43f5e" roughness={0.6} />
      </mesh>
      {/* Golden Ring Accent on Top */}
      <mesh position={[0, 0.02, 0.138]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.015, 0.005, 8, 16]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.1} />
      </mesh>
      {/* Dual color beach stripes on the swimsuit body — a 1mm-proud band wrapping the
          body cylinder, i.e. a decal. DECAL_DEPTH_BIAS keeps it off the body's depth
          plane without moving the stripe anyone actually sees. */}
      <mesh position={[0, -0.02, 0.002]}>
        <cylinderGeometry args={[0.141, 0.141, 0.02, 32]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} {...DECAL_DEPTH_BIAS} />
      </mesh>
    </group>
  )}

  {withSkirt && outfit.hasSkirt && <GrassSkirt />}

  {/* Shell Necklace */}
  {outfit.hasShellNecklace && (
    <mesh position={[0, 0.09, 0.03]} rotation={[Math.PI / 2.3, 0, 0]}>
      <torusGeometry args={[0.155, 0.015, 8, 32]} />
      <meshStandardMaterial color="#ffffff" roughness={0.5} />
    </mesh>
  )}

  {/* Jewellery necklaces - one spec in, one drape out. See NECKLACE_SPECS. */}
  {necklaceSpec && <JewelryNecklace spec={necklaceSpec} />}
    </>
  );
}
