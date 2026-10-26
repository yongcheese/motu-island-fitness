/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';
import {
  MAX_SUBMERGED_TOP_Y,
  SAND_FOOT_RADIUS,
  SEABED_MIN_DEPTH,
  seabedY,
} from '../../constants/world';
import { getWeatherSwayFactors } from '../../utils/weatherSway';

// The reef: everything that lives on the sea floor around the island - the
// seabed itself, coral, seagrass/kelp, the small things scattered between them,
// and the drifting stuff in the water column above.
//
// Read this first, because it explains most of the numbers below:
//
//   * The island's own geometry STOPS at y = -0.7 (Island.tsx's underside disc).
//     There is nothing under the water at all, so the seabed here is not
//     decoration - it is the surface every other piece in this file stands on.
//   * Everything is drawn OPAQUE and lives below the waterline. Ocean.tsx's two
//     surface planes are `transparent` with `depthWrite: false`, so they are
//     drawn after the opaque pass and blend over whatever is down here - that
//     wash is what makes it read as underwater, exactly as it does for Fish.tsx's
//     shoal. Only the bubbles and the jellyfish are transparent, and they carry
//     a negative renderOrder so they still land before the water.
//   * Every family is one InstancedMesh, and every animation runs in the vertex
//     shader off a handful of shared uniforms. There is exactly ONE useFrame in
//     this file and it only writes those uniforms - see the note above it.

// --- Tuning. Everything visual is reachable from here. ---------------------

const OCEAN_DECO = {
  /** Island.tsx's ISLAND_TERRAIN.baseRadius - where the seabed ring starts. */
  islandBaseRadius: 6.84,
  /**
   * Inner/outer edge of the band everything is planted in.
   *
   * The outer edge is set by visibility, not by taste: Ocean.tsx's surface alpha
   * ramps from 0.42 at the coast to 0.9 far out, and past ~17 units there simply
   * isn't enough water clarity left for a coral to read as anything but a smudge.
   */
  reefInner: 9.6,
  reefOuter: 18.0,
  /**
   * Base instance counts at territoryLevel 1. Scaled by islandScale, since the
   * band they are spread over grows with the island.
   */
  counts: {
    seagrass: 32,
    kelp: 11,
    staghorn: 17,
    brain: 11,
    fan: 15,
    sponge: 10,
    anemone: 11,
    starfish: 13,
    urchin: 9,
    pebble: 38,
    jellyfish: 5,
    bubbleColumns: 4,
  },
} as const;

/** Fixed seed, so the reef layout is identical on every reload and re-render. */
const REEF_SEED = 20260803;

/**
 * The ceiling every planted thing is fitted under.
 *
 * Deliberately NOT the -0.62 the original brief asked for. -0.62 sits ABOVE the
 * wave trough, and the water planes are depth-tested - so a frond reaching it
 * would punch a dry hole through each passing trough and briefly render
 * un-watered. See MAX_SUBMERGED_TOP_Y for the full derivation; the fish shoal is
 * kept under the same line.
 */
const MAX_TOP_Y = MAX_SUBMERGED_TOP_Y;

/** Vertical room between the floor at `r` and the surface clearance ceiling. */
function headroom(r: number, islandScale: number): number {
  return MAX_TOP_Y - seabedY(r, islandScale);
}

/**
 * Outer rim of the seabed mesh - a flat plain of floor past the reef band.
 *
 * The `reefOuter` term is not padding. Both the reef band and the sand foot are
 * scaled by islandScale, but they grow from different origins, and past
 * territoryLevel ~4 the band's outer edge overtakes a rim sized only from the
 * foot: at level 5 that left the outermost corals standing at r=44 on a floor
 * that stopped at r=42, i.e. floating over open nothing. Sizing the rim from
 * whichever of the two is further out means it cannot happen at any level.
 */
function seabedOuterRadius(islandScale: number): number {
  return Math.max(OCEAN_DECO.reefOuter * islandScale + 8, 80);
}

// --- Deterministic randomness ----------------------------------------------

/**
 * mulberry32. The layout has to be stable across re-renders (the scene
 * re-renders on every weather change and every profile write), and bare
 * Math.random() in a useMemo would reshuffle the whole reef each time the
 * island scale changed. Seeded, so it also survives a reload unchanged.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Shared shader plumbing -------------------------------------------------

type DecoUniforms = {
  /**
   * Speed-scaled accumulated time, NOT raw elapsed time. Weather changes the
   * current's speed, and multiplying elapsed time by a changing speed would jump
   * the phase of every plant the moment the weather switched; integrating the
   * scaled delta instead keeps the motion continuous through the transition.
   */
  uFlow: { value: number };
  /** Sway amplitude multiplier, from getWeatherSwayFactors. */
  uSway: { value: number };
  /** Strength of the seabed's light-dapple. */
  uCaustics: { value: number };
  /**
   * Water colour for the current weather, which the seabed is mixed toward.
   *
   * THE SEABED HAS TO CARRY THIS OR THE SEA STOPS RESPONDING TO THE WEATHER.
   * Before there was a floor, the near sea was ~42% Ocean.tsx's (fixed) water
   * colour over ~58% SkyDome showing through it - and SkyDome restyles itself
   * per weather, so that 58% is what actually made the shallows go grey in rain
   * and orange at twilight. Dropping an opaque, baked-vertex-colour floor
   * underneath replaced that 58% with something that never changes, which is
   * exactly the "one region that stays the same colour no matter what" this
   * fixes. Lerped, never snapped, to match how Ocean.tsx eases its own haze.
   */
  uWeatherTint: { value: THREE.Color };
  /** Radii over which the seabed ramps from mostly sand to mostly water colour. */
  uTintStart: { value: number };
  uTintEnd: { value: number };
};

/** Per-vertex colours are used as MULTIPLIERS, not as the final colour.
 *
 * Each family is one InstancedMesh, so its hue has to come from the per-instance
 * colour if the family is going to have any variety at all. That leaves vertex
 * colour to carry the parts that must differ *within* a single model regardless
 * of hue - a coral's root-to-tip ramp, a sponge's dark cavity, an anemone's lit
 * tentacle tips. Three multiplies the two together, so writing shade factors
 * here composes with any instance hue.
 *
 * KEEP THESE AT OR BELOW ~1.1. Values above 1 are legal, and the first pass used
 * up to 2.2 to make tips "pop" - but the multiply lands on `diffuseColor` as well
 * as on the emissive term, so anything much over 1 saturates to white under this
 * scene's lighting (ambient 0.5 + hemisphere 0.6 + a 1.4 sun + a sunset IBL). The
 * result was a reef of pale grey models with the hue bleached out of them, which
 * the water wash on top then finished off. Contrast belongs in the ramp's LOWER
 * end - darken the roots instead of over-brightening the tips.
 */
function paint(
  geometry: THREE.BufferGeometry,
  factor: (y: number, index: number, position: THREE.BufferAttribute) => THREE.Color
): THREE.BufferGeometry {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = factor(pos.getY(i), i, pos);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const SHADE = new THREE.Color();
/** Flat multiplier of `v` - the common case for a part with no internal ramp. */
function shade(v: number): THREE.Color {
  return SHADE.setRGB(v, v, v);
}

/**
 * Give a patched material its own program-cache identity.
 *
 * three keys its compiled-program cache on `material.customProgramCacheKey()`,
 * which by default is `onBeforeCompile.toString()` - the function's SOURCE TEXT.
 * Every material built by the two factories below shares one factory body, so
 * their source text is byte-identical and only the captured closure differs:
 * without this, three would hand the second, third and fourth of them the
 * program it compiled for the FIRST, and seagrass, kelp, coral and the sea fans
 * would all silently animate with the seagrass's constants (and both halves of a
 * jellyfish with the bell's). The injected GLSL is what actually differs, so the
 * key has to name it.
 */
function setProgramCacheKey(material: THREE.Material, key: string): void {
  material.customProgramCacheKey = () => key;
}

type SwaySpec = {
  /** Model height the bend weight is normalised against, in object space. */
  refHeight: number;
  /** Tip displacement in object units at uSway = 1. */
  amp: number;
  /** Radians per unit of uFlow. */
  freq: number;
  /** Weight exponent: 2 bends like a stalk, 1 leans like a rigid blade. */
  power?: number;
};

/**
 * Bends a family's geometry in the vertex shader, driven entirely by
 * per-instance attributes and the shared uniforms.
 *
 * The bend is applied to `transformed` in OBJECT space, which is before
 * `project_vertex` folds in `instanceMatrix` - so it composes with each
 * instance's own placement. That is also why `aYaw` exists: the instance matrix
 * spins each plant to a random heading, and without counter-rotating the bend
 * vector by that same yaw every plant would lean a different way and the reef
 * would look agitated rather than swept by one current.
 *
 * The normal is deliberately left alone. These are flat-shaded low-poly fronds
 * seen through half a metre of translucent water at 20+ units; re-deriving the
 * normal for the lean costs a mat3 per vertex and changes nothing visible.
 */
function attachSway(
  material: THREE.Material,
  uniforms: DecoUniforms,
  spec: SwaySpec
): void {
  const power = spec.power ?? 2;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlow = uniforms.uFlow;
    shader.uniforms.uSway = uniforms.uSway;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aPhase;
         attribute float aYaw;
         attribute float aStiff;
         uniform float uFlow;
         uniform float uSway;
         void main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           float hN = clamp(transformed.y / ${spec.refHeight.toFixed(4)}, 0.0, 1.0);
           float w = pow(hN, ${power.toFixed(1)});
           float amp = ${spec.amp.toFixed(4)} * uSway * aStiff * w;
           // Two out-of-phase axes so a frond traces a shallow ellipse rather
           // than ticking back and forth along one line like a metronome.
           float bx = sin(uFlow * ${spec.freq.toFixed(3)} + aPhase) * amp;
           float bz = cos(uFlow * ${(spec.freq * 0.63).toFixed(3)} + aPhase * 1.7) * amp * 0.45;
           float cy = cos(aYaw), sy = sin(aYaw);
           transformed.x += bx * cy - bz * sy;
           transformed.z += bx * sy + bz * cy;
         }`
      );
  };
}

/**
 * Base material for everything planted on the floor.
 *
 * `vertexColors` is load-bearing twice over. It is what carries the shade
 * factors above, and - as Fish.tsx found the hard way - it is also the only way
 * a per-instance colour reaches the fragment shader at all: three 0.184 declares
 * `varying vec4 vColor` behind USE_COLOR, which instanced colour alone does not
 * define, so without it `color_fragment`'s `diffuseColor *= vColor` is compiled
 * out and every instance comes back the material's flat white. Every geometry
 * below therefore has a colour attribute (see `paint`).
 *
 * The emissive term is the same trick Fish.tsx uses: down here a lit surface is
 * seen through the water planes plus the reflection smear, which between them
 * eat well over half its shaded colour, and a purely lit material comes out
 * muddy. A little self-lit glow keeps the reef readable - and the
 * `totalEmissiveRadiance *= vColor` patch is what makes that glow follow each
 * instance's own colour instead of washing the whole family toward one white.
 */
function createReefMaterial(options: {
  emissive?: number;
  roughness?: number;
  side?: THREE.Side;
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // High roughness and zero metalness across the board. Scene.tsx mounts a
    // drei <Environment preset="sunset" />, and a glossy low-roughness surface
    // picks that IBL up as a broad specular sheen - which on a saturated coral
    // reads as "washed out", not as "shiny".
    roughness: options.roughness ?? 0.85,
    metalness: 0,
    flatShading: true,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: options.emissive ?? 0.14,
    side: options.side ?? THREE.FrontSide,
  });
  // Held aside so attachSway (which replaces onBeforeCompile wholesale) can be
  // layered on top without either patch dropping the other.
  (material as ReefMaterial).patchEmissive = patchEmissive;
  material.onBeforeCompile = patchEmissive;
  // Every material from this factory really does compile the same program, so
  // they are all meant to share one cache entry - but the key still has to name
  // the patch, or they would collide with any other MeshStandardMaterial in the
  // scene that happens to match on the built-in parameters.
  setProgramCacheKey(material, `reef|emissive|${options.side ?? THREE.FrontSide}`);
  return material;
}

function patchEmissive(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    // .rgb because vColor is a vec4 while totalEmissiveRadiance is a vec3.
    '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'
  );
}

type ReefMaterial = THREE.MeshStandardMaterial & {
  patchEmissive?: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
};

/** attachSway + the emissive patch on one material. */
function createSwayingReefMaterial(
  uniforms: DecoUniforms,
  spec: SwaySpec,
  options: Parameters<typeof createReefMaterial>[0]
): THREE.MeshStandardMaterial {
  const material = createReefMaterial(options) as ReefMaterial;
  const emissivePatch = material.patchEmissive!;
  attachSway(material, uniforms, spec);
  const swayPatch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    swayPatch(shader, renderer);
    emissivePatch(shader);
  };
  // attachSway bakes the spec into the GLSL as literals, so the spec IS the
  // program's identity - see setProgramCacheKey.
  setProgramCacheKey(
    material,
    `reef|sway|${spec.refHeight}|${spec.amp}|${spec.freq}|${spec.power ?? 2}|${options.side ?? THREE.FrontSide}`
  );
  return material;
}

// --- Geometry builders ------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** A tapered cylinder spanning two points - the building block for anything
 *  branching (coral limbs, anemone tentacles, urchin spines). */
function tubeBetween(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radiusBottom: number,
  radiusTop: number,
  sides = 5
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, len, sides, 1);
  geo.translate(0, len / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  geo.translate(from.x, from.y, from.z);
  return geo;
}

/** A leaf blade: base at y=0, tapering and curling slightly toward the tip. */
function createBlade(width: number, height: number, segments: number, taper: number) {
  const geo = new THREE.PlaneGeometry(width, height, 1, segments);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / height, 0, 1);
    pos.setX(i, pos.getX(i) * (1 - taper * t));
    // A dead-flat card disappears edge-on. A little baked curl means there is
    // always some blade facing the camera whichever way the instance is spun.
    pos.setZ(i, pos.getZ(i) + t * t * width * 0.55);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const SEAGRASS_HEIGHT = 1.0;
function createSeagrassClump(rand: () => number): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const h = SEAGRASS_HEIGHT * (0.6 + rand() * 0.4);
    const blade = createBlade(0.08, h, 5, 0.72);
    // Dark at the root where light doesn't reach, bright at the tip.
    paint(blade, (y) => shade(0.45 + 0.55 * THREE.MathUtils.clamp(y / h, 0, 1)));
    blade.rotateZ((rand() - 0.5) * 0.55);
    blade.rotateY(rand() * Math.PI * 2);
    blade.translate((rand() - 0.5) * 0.24, 0, (rand() - 0.5) * 0.24);
    blades.push(blade);
  }
  return mergeGeometries(blades)!;
}

const KELP_HEIGHT = 2.2;
function createKelp(rand: () => number): THREE.BufferGeometry {
  // Broad straps rising from a shared holdfast, NOT a stem with twigs coming off
  // it. The first version was a narrow stipe plus three little side fronds, and
  // at this camera distance that silhouette reads as a bare dead sapling - the
  // stipe is edge-on half the time and the fronds stick out like branches. Kelp
  // is recognisable by its broad, flat, slightly twisting blades, so the blades
  // ARE the plant here and there is no stem at all.
  const parts: THREE.BufferGeometry[] = [];

  const straps = 4;
  for (let i = 0; i < straps; i++) {
    const h = KELP_HEIGHT * (0.72 + rand() * 0.28);
    const blade = createBlade(0.34 + rand() * 0.1, h, 10, 0.42);
    // A gentle twist along the length, so a strap catches the light differently
    // at different heights instead of being one flat card.
    const pos = blade.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = THREE.MathUtils.clamp(pos.getY(v) / h, 0, 1);
      const a = Math.sin(t * 2.4 + i) * 0.55;
      const x = pos.getX(v);
      const z = pos.getZ(v);
      pos.setX(v, x * Math.cos(a) - z * Math.sin(a));
      pos.setZ(v, x * Math.sin(a) + z * Math.cos(a));
    }
    pos.needsUpdate = true;
    blade.computeVertexNormals();
    paint(blade, (y) => shade(0.42 + 0.58 * THREE.MathUtils.clamp(y / h, 0, 1)));
    // Splay the straps outward from the holdfast like a bunch of ribbons.
    blade.rotateZ((rand() - 0.5) * 0.32);
    blade.rotateY((i / straps) * Math.PI * 2 + rand() * 0.4);
    blade.translate((rand() - 0.5) * 0.14, 0, (rand() - 0.5) * 0.14);
    parts.push(blade);

    // Float bladder on the taller straps only.
    if (h > KELP_HEIGHT * 0.85) {
      const bulb = new THREE.SphereGeometry(0.075, 6, 4);
      bulb.translate(0, h - 0.12, 0);
      paint(bulb, () => SHADE.setRGB(1.05, 1.05, 0.72));
      parts.push(bulb);
    }
  }

  // Holdfast, so the straps look anchored rather than pushed into the sand.
  // A low-segment sphere rather than an icosahedron: IcosahedronGeometry is
  // non-indexed while every blade above is indexed, and mergeGeometries refuses
  // a mixed batch (it returns null, which would take the whole family with it).
  const holdfast = new THREE.SphereGeometry(0.15, 7, 4);
  holdfast.scale(1.3, 0.55, 1.3);
  holdfast.translate(0, 0.04, 0);
  parts.push(paint(holdfast, () => shade(0.38)));

  return mergeGeometries(parts)!;
}

const STAGHORN_HEIGHT = 0.78;
function createStaghorn(rand: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    parts.push(
      paint(tubeBetween(from, to, radius, radius * 0.64), (y) =>
        shade(0.5 + 0.5 * THREE.MathUtils.clamp(y / STAGHORN_HEIGHT, 0, 1))
      )
    );

    if (depth === 0) {
      // Polyp-bright tip. Reads as a growing end, and picks up most of the
      // bioluminescence at twilight since the emissive follows vColor.
      const tip = new THREE.SphereGeometry(radius * 1.05, 5, 4);
      tip.translate(to.x, to.y, to.z);
      parts.push(paint(tip, () => shade(1.12)));
      return;
    }

    const forks = rand() < 0.45 ? 3 : 2;
    for (let i = 0; i < forks; i++) {
      const yaw = rand() * Math.PI * 2;
      const axis = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const next = dir.clone().applyAxisAngle(axis, 0.42 + rand() * 0.38).normalize();
      grow(to, next, len * 0.66, radius * 0.64, depth - 1);
    }
  };

  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), STAGHORN_HEIGHT * 0.46, 0.06, 2);
  return mergeGeometries(parts)!;
}

const BRAIN_RADIUS = 0.29;
const BRAIN_HEIGHT = 0.34;
function createBrain(rand: () => number): THREE.BufferGeometry {
  // Deliberately smaller and lumpier than the first pass, which was a 0.42
  // sphere squashed flat and lit evenly: at up to 1.7x instance scale that made
  // a 1.4-unit smooth yellow disc, and next to the fish it read as a lily pad
  // rather than a coral head. The ridging below is what gives it a surface.
  const geo = new THREE.IcosahedronGeometry(BRAIN_RADIUS, 2);
  const pos = geo.attributes.position;
  const seedA = rand() * 10;
  const seedB = rand() * 10;
  // Displacement must be a pure function of the vertex DIRECTION:
  // IcosahedronGeometry is non-indexed, so a shared corner appears once per
  // face, and displacing by anything else (index, a fresh random) would tear
  // those copies apart into cracks.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ridge =
      0.13 * Math.sin(x * 22 + seedA) * Math.sin(z * 19 + seedB) +
      0.07 * Math.sin((x + z) * 31 + y * 12);
    const bump = 1 + ridge;
    pos.setXYZ(i, x * bump, y * bump, z * bump);
  }
  pos.needsUpdate = true;
  geo.scale(1, 0.62, 1);
  // Sunk a little so it reads as growing out of the sand, not resting on it.
  geo.translate(0, BRAIN_RADIUS * 0.62 * 0.8, 0);
  geo.computeVertexNormals();
  return paint(geo, (y) => shade(0.5 + 0.5 * THREE.MathUtils.clamp(y / BRAIN_HEIGHT, 0, 1)));
}

const FAN_HEIGHT = 0.95;
function createSeaFan(rand: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const width = 1.15;

  const membrane = new THREE.PlaneGeometry(width, FAN_HEIGHT, 9, 7);
  membrane.translate(0, FAN_HEIGHT / 2, 0);
  const pos = membrane.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / FAN_HEIGHT, 0, 1);
    // Narrow stalk at the base, widest around two-thirds up, rounded off at the
    // top - the classic gorgonian silhouette, which is the only thing that reads
    // at this camera distance.
    const profile = 0.14 + 0.86 * Math.sin(t * Math.PI * 0.76 + 0.1);
    pos.setX(i, pos.getX(i) * profile);
    // Dish the fan slightly, so it catches the light as a curved surface rather
    // than flashing on and off as a flat card when the current turns it.
    pos.setZ(i, pos.getZ(i) + Math.sin(t * Math.PI) * 0.07 - Math.abs(pos.getX(i)) * 0.14);
  }
  pos.needsUpdate = true;
  membrane.computeVertexNormals();
  paint(membrane, (y) => shade(0.62 + 0.38 * THREE.MathUtils.clamp(y / FAN_HEIGHT, 0, 1)));
  parts.push(membrane);

  // Ribs are DARKER than the membrane they sit on. Lighter ribs turned the fan
  // into a moth's wing - bright veins on a pale panel - where a gorgonian reads
  // the other way round: a dark branching skeleton showing through the tissue.
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.BoxGeometry(0.026, FAN_HEIGHT * 0.88, 0.03);
    rib.translate(0, FAN_HEIGHT * 0.44, 0);
    rib.rotateZ(i * 0.19 + (rand() - 0.5) * 0.04);
    paint(rib, () => shade(0.4));
    parts.push(rib);
  }

  return mergeGeometries(parts)!;
}

const SPONGE_HEIGHT = 0.72;
/** Profile point index at which the lathe turns over the rim and heads back
 *  down the inside of the barrel - everything from here on is cavity. */
const SPONGE_RIM_INDEX = 6;
function createSponge(rand: () => number): THREE.BufferGeometry {
  // Barrel sponges, lathed rather than stacked from cylinders.
  //
  // The first version was three plain cylinders with a dark disc painted on the
  // top cap, which came out as a row of pink chimneys - the silhouette had no
  // taper and the "mouth" was flat shading with no depth to it. A lathe profile
  // that climbs the outside, rolls over the rim and drops back down the inside
  // gives a real cavity for the same triangle budget, and the flare is what
  // makes the shape read as a sponge and not as masonry.
  const parts: THREE.BufferGeometry[] = [];
  const barrels = [
    { h: 1.0, r: 1.0, x: 0, z: 0 },
    { h: 0.62, r: 0.78, x: 0.21, z: 0.11 },
    { h: 0.4, r: 0.6, x: -0.16, z: 0.19 },
  ];

  for (const b of barrels) {
    const h = SPONGE_HEIGHT * b.h * (0.88 + rand() * 0.24);
    const r = 0.17 * b.r;
    const profile = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(r * 0.62, 0.01 * h),
      new THREE.Vector2(r * 0.8, 0.22 * h),
      new THREE.Vector2(r * 0.86, 0.5 * h),
      new THREE.Vector2(r * 0.97, 0.86 * h),
      new THREE.Vector2(r, 0.97 * h),
      new THREE.Vector2(r * 0.86, h), // rim - SPONGE_RIM_INDEX
      new THREE.Vector2(r * 0.74, 0.9 * h),
      new THREE.Vector2(r * 0.66, 0.62 * h),
      new THREE.Vector2(0.001, 0.58 * h),
    ];
    const barrel = new THREE.LatheGeometry(profile, 11);
    // Lathe walks the profile within each radial segment, so the profile index
    // is recoverable from the vertex index - which is how the cavity gets shaded
    // without a second mesh.
    const stops = profile.length;
    paint(barrel, (y, i) =>
      i % stops >= SPONGE_RIM_INDEX
        ? shade(0.22)
        : shade(0.5 + 0.5 * THREE.MathUtils.clamp(y / SPONGE_HEIGHT, 0, 1))
    );
    barrel.translate(b.x, 0, b.z);
    parts.push(barrel);
  }
  return mergeGeometries(parts)!;
}

const ANEMONE_HEIGHT = 0.5;
function createAnemone(rand: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const column = new THREE.SphereGeometry(0.19, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  column.scale(1, 0.85, 1);
  parts.push(paint(column, () => shade(0.7)));

  const count = 10;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.22;
    const lean = 0.4 + rand() * 0.35;
    const len = 0.3 + rand() * 0.14;
    const from = new THREE.Vector3(Math.sin(a) * 0.085, 0.1, Math.cos(a) * 0.085);
    const dir = new THREE.Vector3(
      Math.sin(a) * Math.sin(lean),
      Math.cos(lean),
      Math.cos(a) * Math.sin(lean)
    );
    const to = from.clone().addScaledVector(dir, len);
    parts.push(
      paint(tubeBetween(from, to, 0.024, 0.013, 4), (y) =>
        shade(0.55 + 0.45 * THREE.MathUtils.clamp(y / ANEMONE_HEIGHT, 0, 1))
      )
    );
    const tip = new THREE.SphereGeometry(0.022, 5, 3);
    tip.translate(to.x, to.y, to.z);
    parts.push(paint(tip, () => shade(1.25)));
  }

  return mergeGeometries(parts)!;
}

function createStarfish(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.SphereGeometry(0.1, 8, 4);
  hub.scale(1, 0.42, 1);
  parts.push(paint(hub, () => shade(0.72)));
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.ConeGeometry(0.075, 0.3, 4);
    arm.translate(0, 0.15, 0);
    arm.rotateX(Math.PI / 2); // lay the cone flat, tip pointing +Z
    arm.scale(1, 0.3, 1); // flatten what is now its vertical thickness
    arm.rotateY((i / 5) * Math.PI * 2);
    parts.push(paint(arm, () => shade(0.92)));
  }
  const geo = mergeGeometries(parts)!;
  geo.translate(0, 0.025, 0);
  return geo;
}

function createUrchin(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.13, 9, 6);
  parts.push(paint(body, () => shade(0.55)));
  const spines = 16;
  for (let i = 0; i < spines; i++) {
    // Fibonacci sphere, biased to the upper half - the buried underside spines
    // would never be seen and are not worth the triangles.
    const t = (i + 0.5) / spines;
    const phi = Math.acos(1 - 1.35 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    const from = dir.clone().multiplyScalar(0.1);
    const to = dir.clone().multiplyScalar(0.28);
    // Graded by distance from the urchin's centre, NOT by vertex index or local
    // Y: tubeBetween has already rotated each spine to point its own way, so
    // radius is the only thing that still means "how far along the spine".
    parts.push(
      paint(tubeBetween(from, to, 0.017, 0.004, 3), (_, idx, pos) => {
        const d = Math.hypot(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        return shade(THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(d, 0.1, 0.28), 0.1, 0.28, 0.6, 1.15));
      })
    );
  }
  const geo = mergeGeometries(parts)!;
  geo.translate(0, 0.14, 0);
  return geo;
}

function createPebble(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(0.22, 0);
  geo.scale(1, 0.62, 1);
  geo.translate(0, 0.07, 0);
  return paint(geo, (y) => shade(0.6 + 0.35 * THREE.MathUtils.clamp(y / 0.28, 0, 1)));
}

// --- Placement --------------------------------------------------------------

type Placed = {
  x: number;
  z: number;
  y: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  scale: number;
  phase: number;
  stiff: number;
  color: THREE.Color;
};

type PlaceOptions = {
  /** Family name, for the dev-only placement audit's messages. */
  name: string;
  count: number;
  islandScale: number;
  rand: () => number;
  /** Radial band, in pre-islandScale units. */
  inner: number;
  outer: number;
  /** Unscaled model height, used to fit under MAX_TOP_Y. */
  modelHeight: number;
  scaleRange: [number, number];
  palette: readonly string[];
  /** Cluster centres to gather around; evenly scattered when omitted. */
  clusters?: Array<{ x: number; z: number }>;
  clusterSpread?: number;
  /** Face the instance along the coast tangent (sea fans, which catch current). */
  tangential?: boolean;
  /** Random lie-down, for things that rest on the floor rather than grow from it. */
  loose?: boolean;
};

function place(options: PlaceOptions): Placed[] {
  const {
    name, count, islandScale, rand, inner, outer, modelHeight, scaleRange, palette,
    clusters, clusterSpread = 1.8, tangential = false, loose = false,
  } = options;

  const items: Placed[] = [];
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (clusters && clusters.length > 0) {
      const c = clusters[i % clusters.length];
      const a = rand() * Math.PI * 2;
      // sqrt so instances fill the cluster disc evenly instead of piling at its
      // centre, which is what a bare uniform radius does.
      const d = Math.sqrt(rand()) * clusterSpread * islandScale;
      x = c.x + Math.cos(a) * d;
      z = c.z + Math.sin(a) * d;
    } else {
      const a = rand() * Math.PI * 2;
      const r = (inner + rand() * (outer - inner)) * islandScale;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }

    // Clamp back into the band: a cluster near the rim can throw an instance
    // onto the beach or out past the murk line.
    const r = Math.hypot(x, z);
    const clamped = THREE.MathUtils.clamp(r, inner * islandScale, outer * islandScale);
    if (r > 1e-4 && clamped !== r) {
      x *= clamped / r;
      z *= clamped / r;
    }
    const finalR = Math.hypot(x, z);

    // Fit under the surface-clearance ceiling by SHRINKING, never by clipping -
    // a truncated kelp is a visibly severed stump, a short one just looks young.
    const wanted = scaleRange[0] + rand() * (scaleRange[1] - scaleRange[0]);
    const room = headroom(finalR, islandScale);
    const scale = Math.min(wanted, room / modelHeight);

    items.push({
      x,
      z,
      y: seabedY(finalR, islandScale),
      yaw: tangential ? Math.atan2(z, x) + Math.PI / 2 : rand() * Math.PI * 2,
      tiltX: loose ? (rand() - 0.5) * 0.5 : 0,
      tiltZ: loose ? (rand() - 0.5) * 0.5 : 0,
      // Degenerate-matrix guard, not a size preference - it must stay small
      // enough that it can never win against the headroom fit above and push an
      // instance back through the surface. With the current profile it never
      // binds: even the shallowest band leaves ~0.7 of headroom.
      scale: Math.max(0.04, scale),
      phase: rand() * Math.PI * 2,
      stiff: 0.6 + rand() * 0.8,
      color: new THREE.Color(palette[Math.floor(rand() * palette.length) % palette.length]),
    });
  }
  auditPlacement(name, items, modelHeight, islandScale);
  return items;
}

/**
 * Dev-only check that the two rules everything here depends on actually held.
 *
 * Both failures are the kind that look like a bad art day rather than a bug: a
 * frond a few centimetres over the ceiling only shows as a flicker when a wave
 * trough passes over it, and an instance seated off the floor only reads as
 * "floating" from one camera angle. They are both exactly computable, so they
 * are checked rather than eyeballed - and checked against the produced data, so
 * a mistyped modelHeight at a call site is caught too.
 */
function auditPlacement(family: string, items: Placed[], modelHeight: number, islandScale: number) {
  if (!import.meta.env.DEV) return;
  for (const item of items) {
    const r = Math.hypot(item.x, item.z);
    const top = item.y + modelHeight * item.scale;
    if (top > MAX_TOP_Y + 1e-6) {
      console.error(
        `[OceanDecorations] ${family} at r=${r.toFixed(2)} tops out at ${top.toFixed(3)}, above the ` +
          `submerged ceiling ${MAX_TOP_Y} - it will punch through a wave trough.`
      );
    }
    const floor = seabedY(r, islandScale);
    if (Math.abs(item.y - floor) > 1e-6) {
      console.error(
        `[OceanDecorations] ${family} at r=${r.toFixed(2)} is seated at ${item.y.toFixed(3)} but the ` +
          `seabed there is ${floor.toFixed(3)} - it is floating or buried.`
      );
    }
  }
}

// --- Instanced family -------------------------------------------------------

function ReefFamily({
  geometry,
  material,
  items,
  sway,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Placed[];
  sway?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Layout, not passive: an InstancedMesh mounts with every instance matrix at
  // identity, and R3F's render loop would otherwise get a frame in between the
  // commit and a passive effect - one frame of the whole family stacked at the
  // world origin, which for the kelp is tall enough to stick out of the lawn.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    dummy.rotation.order = 'YXZ'; // yaw first, so aYaw below really is the world heading
    const phases = new Float32Array(items.length);
    const yaws = new Float32Array(items.length);
    const stiffs = new Float32Array(items.length);

    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(item.tiltX, item.yaw, item.tiltZ);
      dummy.scale.setScalar(item.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, item.color);
      phases[i] = item.phase;
      yaws[i] = item.yaw;
      stiffs[i] = item.stiff;
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    if (sway) {
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.geometry.setAttribute('aYaw', new THREE.InstancedBufferAttribute(yaws, 1));
      mesh.geometry.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stiffs, 1));
    }
  }, [items, sway, geometry]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, items.length]}
      // An InstancedMesh takes its bounding sphere from the geometry sitting at
      // the origin, and every instance here is transformed out to a ring 9-17
      // units away - so the whole family would pop out of existence whenever the
      // island's centre left the frame. Same reason Fish.tsx disables it.
      frustumCulled={false}
      castShadow={false}
      receiveShadow={false}
    />
  );
}

// --- Seabed -----------------------------------------------------------------

/**
 * The floor's radial gradient, as (distance past the sand foot, colour).
 *
 * The first stop is not a design choice: Island.tsx's SandEdge finishes its own
 * dry -> wet -> submerged ramp at `wet.lerp('#2dd4bf', 0.45)`, which is this
 * olive-teal, and starting anywhere else - the bright #c8a86b this used to open
 * on - draws a visible ring where the beach hands over to the sea floor. It
 * warms into sunlit lagoon sand a metre or so out, where nothing is left to
 * match, then cools away into Ocean.tsx's own uDeepColor so the outer rim of the
 * disc dissolves instead of ending on a hard circular edge.
 */
const SEABED_GRADIENT: Array<[number, THREE.Color]> = [
  [0, new THREE.Color('#79a776')],
  [3, new THREE.Color('#8a9e77')],
  [9, new THREE.Color('#5d8580')],
  [20, new THREE.Color('#3d6b78')],
];
/** Samples SEABED_GRADIENT at `d` metres past the sand foot, into `out`. */
function seabedColorAt(d: number, out: THREE.Color): THREE.Color {
  const stops = SEABED_GRADIENT;
  if (d <= stops[0][0]) return out.copy(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i][0]) {
      const t = (d - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return out.copy(stops[i - 1][1]).lerp(stops[i][1], THREE.MathUtils.smoothstep(t, 0, 1));
    }
  }
  return out.copy(stops[stops.length - 1][1]);
}

function createSeabedGeometry(islandScale: number): THREE.BufferGeometry {
  const inner = OCEAN_DECO.islandBaseRadius * islandScale;
  const outer = seabedOuterRadius(islandScale);
  const geo = new THREE.RingGeometry(inner, outer, 72, 26);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const foot = SAND_FOOT_RADIUS * islandScale;

  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    // RingGeometry is authored in XY; local Z becomes world Y after the rotate
    // below, so the depth profile is written into Z here.
    pos.setZ(i, seabedY(r, islandScale));

    const d = r - foot;
    seabedColorAt(d, c);
    // Mottling, so the floor isn't a perfectly smooth radial ramp. Two
    // incommensurable frequencies over the vertex's own XZ, which never repeats
    // into a visible grid at the density this mesh is tessellated to.
    const patch =
      Math.sin(pos.getX(i) * 0.44 + 1.7) * Math.sin(pos.getY(i) * 0.37) * 0.05 +
      Math.sin((pos.getX(i) + pos.getY(i)) * 0.9) * 0.025;
    c.offsetHSL(0, 0, patch);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // Rotate the GEOMETRY (not the mesh) so the displaced profile and its normals
  // land in world orientation together and the mesh needs no transform of its own.
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Lambert, not Standard, and this one line is the single largest thing on the island's frame.
 *
 * Measured on an Intel UHD laptop at 1440x900: this ONE mesh cost 5.79 ms of a 20.2 ms frame -
 * 29% of everything - and swapping the material here (and nothing else) gave 3.06 ms of it back.
 * Nothing about the mesh is unusual; it is simply the biggest thing on screen. The seabed spans
 * 160 world units and fills most of the frame below the horizon, so its fragment shader is paid
 * for over more pixels than any other surface in the scene, and MeshStandardMaterial's is the
 * most expensive one three ships: a full physical BRDF plus an image-based lighting lookup into
 * the HDRI <Environment>, evaluated per pixel.
 *
 * The reason it can go is written a few lines below, in the tint. `tintAmt` runs from 0.85 at the
 * reef to 0.99 out past it, and the line under `<colorspace_fragment>` mixes the lit colour
 * TOWARD `uWeatherTint` by exactly that much - so between 85% and 99% of everything the physical
 * shader just computed was being thrown away on the next instruction. The seabed is not a lit
 * surface that happens to be tinted; it is the water's colour with a hint of floor left in it,
 * and it was paying for specular highlights and an environment reflection that survive at one
 * part in a hundred through twenty units of translucent water.
 *
 * Lambert keeps the part that does survive - diffuse light falling on sand, so the floor still
 * darkens under 暴風雨 and warms at 暮色 with the same three lights - and drops the rest. Both
 * shader chunks this patch injects into (`begin_vertex`, `colorspace_fragment`) exist in
 * Lambert's shaders verbatim, so the caustics and the tint below are unchanged.
 *
 * The reef pieces standing ON this floor deliberately stay Standard: they are small, they are the
 * thing the eye actually goes to, and 167 instances of coral cost a fraction of what one
 * screen-filling floor does.
 */
function createSeabedMaterial(uniforms: DecoUniforms): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlow = uniforms.uFlow;
    shader.uniforms.uCaustics = uniforms.uCaustics;
    shader.uniforms.uWeatherTint = uniforms.uWeatherTint;
    shader.uniforms.uTintStart = uniforms.uTintStart;
    shader.uniforms.uTintEnd = uniforms.uTintEnd;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vSeabed;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvSeabed = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vSeabed;
         uniform float uFlow;
         uniform float uCaustics;
         uniform vec3 uWeatherTint;
         uniform float uTintStart;
         uniform float uTintEnd;
         void main() {`
      )
      .replace(
        // AFTER colorspace conversion, i.e. the very last thing this shader
        // does - NOT on `diffuseColor` up in <color_fragment>, which is where
        // this started and why the sea still would not go orange at twilight.
        //
        // What this stands in for is SkyDome, and SkyDome is a raw
        // ShaderMaterial: it writes its colour straight out with no lighting, no
        // ACES tone mapping and no output colour-space conversion. Mixing into
        // `diffuseColor` instead puts the sky colour through all three - the
        // lighting alone knocks it well down (a lit floor cannot be as bright as
        // an unlit dome), and ACES then desaturates what is left. Twilight's
        // #ea580c came out a muddy brown that barely shifted the water.
        // Injecting here means the tint lands in the framebuffer as exactly the
        // value SkyDome would have written, so the water blending over it
        // resolves to the same colour it did when there was no floor at all.
        '#include <colorspace_fragment>',
        `#include <colorspace_fragment>
         {
           // One radius for both ramps below - it used to be measured twice.
           float seabedR = length(vSeabed.xz);
           float tintRamp = smoothstep(uTintStart, uTintEnd, seabedR);
           float tintAmt = mix(${SEABED_TINT_NEAR.toFixed(3)}, ${SEABED_TINT_FAR.toFixed(3)}, tintRamp);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, uWeatherTint, tintAmt);

           // Caustics go on AFTER the tint, not into totalEmissiveRadiance where
           // they used to live. The tint now replaces 85-99% of this surface, so
           // anything added before it survives at 15% or less - the dapple was
           // being all but erased by the very fix that restored the sea's colour.
           // Laying it over the top is also truer to what it depicts: this is
           // light landing on the sea floor, so it belongs on top of the floor's
           // colour rather than mixed into it.
           //
           // 1.6, not the 0.55 this started at. The frequency is what decides
           // whether this reads as caustics at all: at 0.55 one cell is ~11 world
           // units across, so the entire reef band fitted inside two or three of
           // them and the effect came out as one broad pale wash over the sand
           // rather than as moving light. At 1.6 a cell is ~4 units, which is
           // about a coral apart - close enough to see the pattern crawl.
           // The two fades come FIRST so the dapple can be skipped where they have already
           // closed it down. Refracted sunlight dies off with depth, and with the murk - a
           // dapple nobody can see through 20 units of water is just noise - so past uTintEnd
           // this whole block contributes exactly nothing. That is not a corner of the mesh:
           // the seabed reaches 80 units and the tint is finished long before its rim, so most
           // of this floor's pixels were paying four sines and a pow() to add zero.
           float depthFade = smoothstep(${SEABED_MIN_DEPTH.toFixed(2)}, -0.85, vSeabed.y);
           float rangeFade = 1.0 - smoothstep(uTintStart + 6.0, uTintEnd, seabedR);
           float causticAmt = uCaustics * depthFade * rangeFade;
           if (causticAmt > 0.0005) {
             vec2 q = vSeabed.xz * 1.6;
             float c = sin(q.x + uFlow * 0.5) * sin(q.y * 1.13 - uFlow * 0.38);
             c += sin((q.x + q.y) * 0.77 + uFlow * 0.62) * 0.6;
             // A second, finer octave breaks the first one's regular grid up into
             // something closer to the branching filaments real caustics make.
             c += sin(q.x * 2.3 - q.y * 1.7 + uFlow * 0.9) * 0.35;
             // High power turns the smooth sine field into thin bright lines
             // rather than soft blobs.
             c = pow(max(c, 0.0) * 0.55, 3.5);
             gl_FragColor.rgb += c * causticAmt * vec3(0.5, 0.82, 0.76);
           }
         }`
      );
  };
  setProgramCacheKey(material, 'reef|seabed-caustics');
  return material;
}

function Seabed({ islandScale, uniforms }: { islandScale: number; uniforms: DecoUniforms }) {
  const geometry = useMemo(() => createSeabedGeometry(islandScale), [islandScale]);
  const material = useMemo(() => createSeabedMaterial(uniforms), [uniforms]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} material={material} castShadow={false} receiveShadow={false} />
  );
}

// --- Bubbles ----------------------------------------------------------------

const BUBBLES_PER_COLUMN = 20;

/**
 * Rising bubble columns, as a single Points cloud with the whole rise cycle in
 * the vertex shader.
 *
 * `fract()` on the flow time is the entire simulation: each bubble's height is a
 * pure function of time and its own phase, so there is no particle array to
 * update, nothing to respawn, and no per-frame CPU cost at all.
 */
function createBubbleMaterial(uniforms: DecoUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFlow: uniforms.uFlow,
      uPixelRatio: { value: Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio) },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aRise;
      attribute float aSize;
      uniform float uFlow;
      uniform float uPixelRatio;
      varying float vFade;

      void main() {
        float t = fract(uFlow * aSpeed + aPhase);
        vec3 pos = position;
        pos.y += t * aRise;
        // Bubbles wobble as they rise; the amplitude grows with height because
        // they speed up and widen on the way to the surface.
        pos.x += sin(uFlow * 1.7 + aPhase * 6.2) * 0.05 * t;
        pos.z += cos(uFlow * 1.4 + aPhase * 5.1) * 0.05 * t;

        // Fade in off the vent and out again just before the ceiling, so a
        // bubble never blinks out of existence mid-water on the cycle wrap.
        vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.78, 1.0, t));

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * (1.0 + t * 0.5) * 300.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        // Bright rim, hollow middle - a bubble is a shell, not a dot.
        float rim = smoothstep(0.22, 0.5, d) * (1.0 - smoothstep(0.46, 0.5, d));
        float body = (1.0 - smoothstep(0.0, 0.5, d)) * 0.25;
        gl_FragColor = vec4(vec3(0.88, 0.99, 1.0), (rim + body) * vFade * 0.75);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function Bubbles({
  islandScale,
  uniforms,
  rand,
}: {
  islandScale: number;
  uniforms: DecoUniforms;
  rand: () => number;
}) {
  const material = useMemo(() => createBubbleMaterial(uniforms), [uniforms]);

  const geometry = useMemo(() => {
    const columns = OCEAN_DECO.counts.bubbleColumns;
    const total = columns * BUBBLES_PER_COLUMN;
    const positions = new Float32Array(total * 3);
    const phases = new Float32Array(total);
    const speeds = new Float32Array(total);
    const rises = new Float32Array(total);
    const sizes = new Float32Array(total);

    for (let c = 0; c < columns; c++) {
      const a = rand() * Math.PI * 2;
      const r = (OCEAN_DECO.reefInner + 1 + rand() * 5) * islandScale;
      const vx = Math.cos(a) * r;
      const vz = Math.sin(a) * r;
      const vy = seabedY(r, islandScale) + 0.05;
      // Stop short of MAX_TOP_Y for the same reason everything else does: a
      // bubble breaking the wave trough would render over the water, not under it.
      const rise = Math.max(0.4, MAX_TOP_Y - 0.06 - vy);

      for (let i = 0; i < BUBBLES_PER_COLUMN; i++) {
        const k = c * BUBBLES_PER_COLUMN + i;
        positions[k * 3] = vx + (rand() - 0.5) * 0.22;
        positions[k * 3 + 1] = vy;
        positions[k * 3 + 2] = vz + (rand() - 0.5) * 0.22;
        phases[k] = rand();
        speeds[k] = 0.1 + rand() * 0.06;
        rises[k] = rise * (0.75 + rand() * 0.25);
        sizes[k] = 0.035 + rand() * 0.03;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aRise', new THREE.BufferAttribute(rises, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return geo;
    // `rand` is the reef's own seeded stream - see OceanDecorations' useMemo.
  }, [islandScale, rand]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // renderOrder < the ocean's 0/1 so the water still blends over the bubbles
  // instead of the transparent sort deciding it on depth alone and flickering.
  return <points geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} />;
}

// --- Jellyfish --------------------------------------------------------------

const JELLY_BELL_RADIUS = 0.3;

/**
 * The drift, bob and bell pulse all run in the vertex shader off per-instance
 * attributes, so the jellyfish cost the same as any other static instanced mesh.
 *
 * `aDrift`/`aBob` are pre-divided by the instance's scale, because the offset is
 * added to `transformed` in OBJECT space and `instanceMatrix` multiplies the
 * scale back in afterwards - without that, a large jellyfish would swing over a
 * proportionally larger circle than a small one.
 */
function attachJellyMotion(material: THREE.Material, uniforms: DecoUniforms, isBell: boolean) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlow = uniforms.uFlow;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aPhase;
         attribute float aDrift;
         attribute float aBob;
         uniform float uFlow;
         void main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           float pulse = sin(uFlow * 0.9 + aPhase) * 0.5 + 0.5;
           ${isBell
            ? `// Bell contracts tall-and-narrow, then relaxes flat-and-wide.
               transformed.y *= 0.86 + 0.3 * pulse;
               transformed.xz *= 1.08 - 0.17 * pulse;`
            : `// Tentacles trail the bell's pulse and swing more the further they
               // hang, which is what sells them as slack rather than rigid.
               float w = clamp(-transformed.y / 0.75, 0.0, 1.0);
               transformed.x += sin(uFlow * 0.9 + aPhase + 1.1) * 0.09 * w * w;
               transformed.z += cos(uFlow * 0.75 + aPhase * 1.4) * 0.07 * w * w;
               transformed.y *= 0.94 + 0.12 * pulse;`}

           float ang = uFlow * 0.11 + aPhase;
           transformed.x += cos(ang) * aDrift;
           transformed.z += sin(ang) * aDrift;
           transformed.y += sin(uFlow * 0.5 + aPhase * 1.3) * aBob;
         }`
      );
  };
}

function createJellyGeometry(): { bell: THREE.BufferGeometry; tentacles: THREE.BufferGeometry } {
  const bell = new THREE.SphereGeometry(JELLY_BELL_RADIUS, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.58);
  bell.scale(1, 0.85, 1);
  paint(bell, (y) => shade(0.7 + 0.35 * THREE.MathUtils.clamp(y / (JELLY_BELL_RADIUS * 0.85), 0, 1)));

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(a) * 0.15, -0.02, Math.sin(a) * 0.15);
    const to = new THREE.Vector3(Math.cos(a) * 0.19, -0.72, Math.sin(a) * 0.19);
    parts.push(paint(tubeBetween(from, to, 0.02, 0.007, 4), (y) => shade(0.5 - y * 0.4)));
  }
  return { bell, tentacles: mergeGeometries(parts)! };
}

const JELLY_PALETTE = ['#e9d5ff', '#a5f3fc', '#fbcfe8'] as const;

function Jellyfish({
  islandScale,
  uniforms,
  rand,
}: {
  islandScale: number;
  uniforms: DecoUniforms;
  rand: () => number;
}) {
  const bellRef = useRef<THREE.InstancedMesh>(null);
  const tentacleRef = useRef<THREE.InstancedMesh>(null);

  const { bell, tentacles } = useMemo(() => createJellyGeometry(), []);

  const materials = useMemo(() => {
    const make = (isBell: boolean) => {
      const m = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: isBell ? 0.45 : 0.35,
        depthWrite: false,
        roughness: 0.35,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.4,
        side: THREE.DoubleSide,
        // One pass, not three's default two for a transparent DoubleSide surface. The default
        // draws back faces then front faces by flipping `side` and setting `needsUpdate` twice
        // per material per frame, which sends both jellies through the full program lookup
        // (getParameters + cache key) four times a frame, forever - measured as the only
        // materials on the island whose version climbed every frame. A faint 0.35-0.45 bell
        // and a handful of thin tentacles have no visible back-to-front ordering to protect.
        forceSinglePass: true,
      });
      attachJellyMotion(m, uniforms, isBell);
      const motion = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        motion(shader, renderer);
        patchEmissive(shader);
      };
      // The bell and the tentacles are built by the same closure, so their
      // onBeforeCompile source text is identical and three would compile only
      // the first - giving the tentacles the bell's contraction. See
      // setProgramCacheKey.
      setProgramCacheKey(m, `reef|jelly|${isBell ? 'bell' : 'tentacles'}`);
      return m;
    };
    return { bell: make(true), tentacles: make(false) };
  }, [uniforms]);

  const items = useMemo(() => {
    const count = Math.round(OCEAN_DECO.counts.jellyfish * islandScale);
    return Array.from({ length: count }, () => {
      const a = rand() * Math.PI * 2;
      const r = (OCEAN_DECO.reefInner + 1.5 + rand() * 6) * islandScale;
      const scale = 0.7 + rand() * 0.6;
      const bob = 0.22;
      const floor = seabedY(r, islandScale);
      // Centre the bob band between the floor and the surface clearance, so a
      // jellyfish can neither scrape the reef nor break the wave trough.
      const lowest = floor + 0.9;
      const highest = MAX_TOP_Y - JELLY_BELL_RADIUS * 0.85 * scale - bob;
      return {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        y: Math.min(Math.max(lowest, highest - 0.3), highest),
        scale,
        phase: rand() * Math.PI * 2,
        drift: (0.5 + rand() * 0.6) / scale,
        bob: bob / scale,
        color: new THREE.Color(JELLY_PALETTE[Math.floor(rand() * JELLY_PALETTE.length) % JELLY_PALETTE.length]),
      };
    });
  }, [islandScale, rand]);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const phases = new Float32Array(items.length);
    const drifts = new Float32Array(items.length);
    const bobs = new Float32Array(items.length);

    items.forEach((item, i) => {
      phases[i] = item.phase;
      drifts[i] = item.drift;
      bobs[i] = item.bob;
    });

    for (const mesh of [bellRef.current, tentacleRef.current]) {
      if (!mesh) continue;
      items.forEach((item, i) => {
        dummy.position.set(item.x, item.y, item.z);
        dummy.rotation.set(0, 0, 0); // no yaw: the shader's drift is in object space
        dummy.scale.setScalar(item.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, item.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.geometry.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drifts, 1));
      mesh.geometry.setAttribute('aBob', new THREE.InstancedBufferAttribute(bobs, 1));
    }
  }, [items]);

  useEffect(() => {
    return () => {
      bell.dispose();
      tentacles.dispose();
      materials.bell.dispose();
      materials.tentacles.dispose();
    };
  }, [bell, tentacles, materials]);

  if (items.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={tentacleRef}
        args={[tentacles, materials.tentacles, items.length]}
        renderOrder={-1}
        frustumCulled={false}
      />
      <instancedMesh
        ref={bellRef}
        args={[bell, materials.bell, items.length]}
        renderOrder={-1}
        frustumCulled={false}
      />
    </group>
  );
}

// --- Weather ----------------------------------------------------------------

/**
 * Per-weather look, on top of the shared wind factors.
 *
 * `sway`/`speed` come from getWeatherSwayFactors so the reef breathes in step
 * with the palms and the garden - there is deliberately no second weather table
 * for that here. What IS local is how much light gets down: caustics need direct
 * sun, and the bioluminescence is the reef's own light, which only becomes the
 * dominant source once the sun has gone.
 */
/**
 * Glow in fair weather. Each material's own emissiveIntensity is authored
 * against this, and the weather ramp below is applied as a ratio to it, so a
 * family can be made more or less self-lit than its neighbours without also
 * changing how hard it lights up at twilight.
 */
const SUNNY_GLOW = 0.14;

/**
 * The colour the sea floor takes on under each sky - see DecoUniforms.uWeatherTint.
 *
 * THESE ARE SKYDOME'S OWN `bottom` COLOURS, deliberately copied rather than
 * reinterpreted. Ocean.tsx's water colours are fixed constants; the only reason
 * this sea ever looked different in different weather is that it is translucent
 * and you were seeing the SKY through it - ~58% of the near sea, which is why
 * twilight turned the whole surface orange rather than just the horizon. An
 * opaque sea floor replaces exactly that 58%, so to keep the effect the floor
 * has to stand in for the sky it displaced, at the sky's own colour.
 *
 * A first attempt used muted "underwater" versions of these (a brown #95522f
 * for twilight instead of the sky's #ea580c) and it was far too timid - the sea
 * shifted a little instead of visibly changing colour. Faithful beats tasteful
 * here: this is restoring an existing look, not designing a new one. Keep in
 * step with SkyDome.tsx's per-weather `bottom`.
 */
const SEABED_WEATHER_TINT: Record<WeatherType, string> = {
  [WeatherType.SUNNY]: '#e0f2fe',
  [WeatherType.RAINY]: '#94a3b8',
  [WeatherType.STORM]: '#334155',
  [WeatherType.SNOW]: '#f1f5f9',
  [WeatherType.TWILIGHT]: '#ea580c',
  [WeatherType.MIDNIGHT]: '#1b2a52',
};

/**
 * How far the floor is pulled toward {@link SEABED_WEATHER_TINT}, nearest the
 * beach and far out.
 *
 * These are high on purpose, and the reason is arithmetic rather than taste.
 * The sea's colour is `alpha * water + (1 - alpha) * whatever_is_behind_it`, and
 * inshore alpha is 0.42 - so 58% of the sea used to BE the sky. The goal is that
 * the composite comes out at the colour it did before there was a floor, which
 * means the floor has to be the sky, not merely lean toward it. At 0.85 the
 * sea inshore lands within ~9% of its original colour; the remaining 15% is what
 * keeps the sand, the caustics and the reef floor from disappearing into a flat
 * sheet of sky. Two earlier attempts at 0.45 and 0.7 both read as "the sea still
 * isn't following the weather", which is exactly what that 9% budget says they
 * should: at 0.45 the sea was more than a third off its old colour.
 *
 * Ocean.tsx is deliberately left completely alone. An earlier pass gave the
 * water body its own per-weather palette, which did make the sea change colour -
 * but it changed it to a NEW colour, invented here, rather than the one the
 * scene already had. Restoring an existing look means reproducing the mechanism
 * that produced it, not repainting it from scratch.
 */
const SEABED_TINT_NEAR = 0.85;
const SEABED_TINT_FAR = 0.99;

function getReefWeatherLook(weather: WeatherType): { caustics: number; glow: number } {
  switch (weather) {
    case WeatherType.RAINY:
      return { caustics: 0.4, glow: 0.13 };
    case WeatherType.STORM:
      return { caustics: 0.12, glow: 0.13 };
    case WeatherType.SNOW:
      return { caustics: 0.5, glow: 0.11 };
    case WeatherType.TWILIGHT:
      return { caustics: 0.3, glow: 0.62 };
    case WeatherType.MIDNIGHT:
      // Almost no caustics — moonlight does not carry them — but the highest
      // reef glow of any state, so the seabed reads as bioluminescent rather
      // than as an unlit black hole under the water.
      return { caustics: 0.12, glow: 0.78 };
    default:
      return { caustics: 1.0, glow: SUNNY_GLOW };
  }
}

// --- Palettes ---------------------------------------------------------------
// Deliberately saturated MID-tones, for the same reason Fish.tsx's are: roughly
// half of each instance's shaded colour is eaten by the water planes above it
// before it reaches the camera. The first pass used the pastel end of each hue
// (#fda4af, #a78bfa, #f9a8d4) and the water wash took them the rest of the way
// to grey - a 500/600-weight colour is what survives to look like the pastel the
// pastel was meant to be.

const PALETTES = {
  seagrass: ['#22c55e', '#16a34a', '#4d7c0f'],
  kelp: ['#166534', '#14532d', '#365314'],
  staghorn: ['#f43f5e', '#ec4899', '#f97316'],
  brain: ['#f59e0b', '#d97706', '#ea580c'],
  fan: ['#8b5cf6', '#a855f7', '#d946ef'],
  sponge: ['#e11d48', '#fb7185', '#f59e0b'],
  anemone: ['#06b6d4', '#ec4899', '#14b8a6'],
  starfish: ['#ea580c', '#e11d48', '#f59e0b'],
  urchin: ['#6d28d9', '#5b21b6', '#7e22ce'],
  pebble: ['#546b7a', '#475569', '#6b7f8c'],
} as const;

// --- Root -------------------------------------------------------------------

export function OceanDecorations() {
  const { profile, weather } = useAppPick('profile', 'weather');
  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4;

  const uniforms = useMemo<DecoUniforms>(
    () => ({
      uFlow: { value: 0 },
      uSway: { value: 1 },
      uCaustics: { value: 1 },
      uWeatherTint: { value: new THREE.Color(SEABED_WEATHER_TINT[WeatherType.SUNNY]) },
      uTintStart: { value: 0 },
      uTintEnd: { value: 1 },
    }),
    []
  );

  // One seeded stream for the whole reef, drawn from in a fixed order, so the
  // layout is reproducible - and only ever re-rolled when the island resizes.
  const layout = useMemo(() => {
    const rand = mulberry32(REEF_SEED);
    const n = (base: number) => Math.round(base * islandScale);

    // Coral grows in patches, not in an even sprinkle. Cluster centres are
    // spaced by angle so no two patches merge into one shapeless mass.
    const clusterCount = 6;
    const clusters = Array.from({ length: clusterCount }, (_, i) => {
      const a = ((i + rand() * 0.55) / clusterCount) * Math.PI * 2;
      const r = (OCEAN_DECO.reefInner + 0.8 + rand() * (OCEAN_DECO.reefOuter - OCEAN_DECO.reefInner - 2.5)) * islandScale;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    });

    const band = { inner: OCEAN_DECO.reefInner, outer: OCEAN_DECO.reefOuter, islandScale, rand };

    return {
      // Geometry is rolled from the same stream, so the models themselves are
      // stable too - a re-render must not silently re-grow every coral.
      geometries: {
        seagrass: createSeagrassClump(rand),
        kelp: createKelp(rand),
        staghorn: createStaghorn(rand),
        brain: createBrain(rand),
        fan: createSeaFan(rand),
        sponge: createSponge(rand),
        anemone: createAnemone(rand),
        starfish: createStarfish(),
        urchin: createUrchin(),
        pebble: createPebble(),
      },
      items: {
        // Seagrass likes the bright shallows just off the beach.
        seagrass: place({
          ...band,
          name: 'seagrass',
          inner: OCEAN_DECO.reefInner - 0.6,
          outer: OCEAN_DECO.reefInner + 6,
          count: n(OCEAN_DECO.counts.seagrass),
          modelHeight: SEAGRASS_HEIGHT,
          scaleRange: [0.85, 1.45],
          palette: PALETTES.seagrass,
        }),
        // Kelp needs real depth - anything shallower and it would be shrunk to a
        // stub by the surface-clearance fit.
        kelp: place({
          ...band,
          name: 'kelp',
          inner: 14,
          count: n(OCEAN_DECO.counts.kelp),
          modelHeight: KELP_HEIGHT,
          scaleRange: [0.8, 1.25],
          palette: PALETTES.kelp,
        }),
        staghorn: place({
          ...band,
          name: 'staghorn',
          count: n(OCEAN_DECO.counts.staghorn),
          modelHeight: STAGHORN_HEIGHT,
          scaleRange: [0.9, 1.6],
          palette: PALETTES.staghorn,
          clusters,
          clusterSpread: 2.1,
        }),
        brain: place({
          ...band,
          name: 'brain',
          count: n(OCEAN_DECO.counts.brain),
          modelHeight: BRAIN_HEIGHT,
          scaleRange: [0.9, 1.7],
          palette: PALETTES.brain,
          clusters,
          clusterSpread: 2.4,
        }),
        fan: place({
          ...band,
          name: 'fan',
          count: n(OCEAN_DECO.counts.fan),
          modelHeight: FAN_HEIGHT,
          scaleRange: [0.8, 1.35],
          palette: PALETTES.fan,
          clusters,
          clusterSpread: 2.6,
          tangential: true,
        }),
        sponge: place({
          ...band,
          name: 'sponge',
          count: n(OCEAN_DECO.counts.sponge),
          modelHeight: SPONGE_HEIGHT,
          scaleRange: [0.9, 1.5],
          palette: PALETTES.sponge,
          clusters,
          clusterSpread: 2.2,
        }),
        anemone: place({
          ...band,
          name: 'anemone',
          count: n(OCEAN_DECO.counts.anemone),
          modelHeight: ANEMONE_HEIGHT,
          scaleRange: [0.85, 1.5],
          palette: PALETTES.anemone,
          clusters,
          clusterSpread: 2.8,
        }),
        starfish: place({
          ...band,
          name: 'starfish',
          inner: OCEAN_DECO.reefInner - 0.8,
          count: n(OCEAN_DECO.counts.starfish),
          modelHeight: 0.1,
          scaleRange: [0.9, 1.5],
          palette: PALETTES.starfish,
        }),
        urchin: place({
          ...band,
          name: 'urchin',
          count: n(OCEAN_DECO.counts.urchin),
          modelHeight: 0.42,
          scaleRange: [0.85, 1.3],
          palette: PALETTES.urchin,
        }),
        pebble: place({
          ...band,
          name: 'pebble',
          inner: OCEAN_DECO.reefInner - 1.2,
          count: n(OCEAN_DECO.counts.pebble),
          modelHeight: 0.3,
          scaleRange: [0.6, 1.6],
          palette: PALETTES.pebble,
          loose: true,
        }),
      },
      rand,
    };
  }, [islandScale]);

  const materials = useMemo(() => {
    return {
      // Fronds bend from the root: power 2, big amplitude, slow.
      seagrass: createSwayingReefMaterial(
        uniforms,
        { refHeight: SEAGRASS_HEIGHT, amp: 0.14, freq: 1.1 },
        { emissive: 0.13, roughness: 0.85, side: THREE.DoubleSide }
      ),
      kelp: createSwayingReefMaterial(
        uniforms,
        { refHeight: KELP_HEIGHT, amp: 0.4, freq: 0.7 },
        { emissive: 0.11, roughness: 0.9, side: THREE.DoubleSide }
      ),
      // Coral is calcified. It barely moves - just enough that it isn't dead
      // still next to the plants.
      staghorn: createSwayingReefMaterial(
        uniforms,
        { refHeight: STAGHORN_HEIGHT, amp: 0.025, freq: 1.4 },
        { emissive: 0.16 }
      ),
      brain: createReefMaterial({ emissive: 0.15, roughness: 0.92 }),
      // A sea fan is a membrane held broadside to the current - the liveliest
      // thing on the reef, and the reason it is placed tangentially.
      fan: createSwayingReefMaterial(
        uniforms,
        { refHeight: FAN_HEIGHT, amp: 0.11, freq: 0.95, power: 1.6 },
        { emissive: 0.15, roughness: 0.86, side: THREE.DoubleSide }
      ),
      sponge: createReefMaterial({ emissive: 0.15, roughness: 0.9 }),
      // Tentacles only: the column below them is under refHeight's weight curve
      // and stays put, which is exactly how an anemone moves.
      anemone: createSwayingReefMaterial(
        uniforms,
        { refHeight: ANEMONE_HEIGHT, amp: 0.06, freq: 1.8 },
        { emissive: 0.2, roughness: 0.8 }
      ),
      starfish: createReefMaterial({ emissive: 0.14, roughness: 0.9 }),
      urchin: createReefMaterial({ emissive: 0.14, roughness: 0.85 }),
      pebble: createReefMaterial({ emissive: 0.08, roughness: 0.97 }),
    };
  }, [uniforms]);

  /** Materials whose emissiveIntensity is driven by the weather glow below. */
  const glowMaterials = useMemo(
    () => [materials.staghorn, materials.anemone, materials.fan, materials.brain, materials.sponge],
    [materials]
  );
  const baseGlow = useMemo(() => glowMaterials.map((m) => m.emissiveIntensity), [glowMaterials]);
  /** Scratch for the per-frame tint lerp - one Color, not one per frame. */
  const tintTarget = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    return () => {
      Object.values(materials).forEach((m) => m.dispose());
      Object.values(layout.geometries).forEach((g) => g.dispose());
    };
  }, [materials, layout]);

  /**
   * The one and only useFrame in this file.
   *
   * Every animated thing on the reef - the sway, the caustics, the bubbles, the
   * jellyfish - reads these three uniforms in its own vertex shader, so the
   * per-frame CPU cost of the entire system is this handful of scalar writes,
   * independent of how many instances are on screen. The alternative (a JS loop
   * recomposing a matrix per plant) is the pattern Island.tsx's Grass was
   * rewritten to get rid of.
   */
  useFrame((_, rawDelta) => {
    const { speedMult, swayAmt } = getWeatherSwayFactors(weather);
    const look = getReefWeatherLook(weather);
    // Clamped: a backgrounded tab returns one enormous delta, which would jump
    // the whole reef's phase in a single frame.
    const delta = Math.min(rawDelta, 0.1);

    // Integrated rather than `elapsed * speed` so a weather change ramps the
    // current's speed without discontinuously jumping every plant's phase.
    uniforms.uFlow.value += delta * THREE.MathUtils.lerp(1, speedMult, 0.75);
    uniforms.uSway.value = THREE.MathUtils.damp(uniforms.uSway.value, swayAmt, 1.5, delta);
    uniforms.uCaustics.value = THREE.MathUtils.damp(uniforms.uCaustics.value, look.caustics, 1.5, delta);

    // The floor's own weather response. Eased at the same rate as everything
    // else here rather than snapped, so switching weather washes the colour
    // across the shallows the way Ocean.tsx's horizon haze already does.
    tintTarget.set(SEABED_WEATHER_TINT[weather] || SEABED_WEATHER_TINT[WeatherType.SUNNY]);
    uniforms.uWeatherTint.value.lerp(tintTarget, 1 - Math.exp(-1.2 * delta));
    // Radii are cheap to write and depend on islandScale, which can change at
    // runtime when territory is expanded - so they are refreshed here rather
    // than baked into the material at build time.
    uniforms.uTintStart.value = SAND_FOOT_RADIUS * islandScale + 1.5;
    uniforms.uTintEnd.value = SAND_FOOT_RADIUS * islandScale + 26;

    // emissiveIntensity is a plain material property, not a uniform we own, so
    // it is eased here instead - five scalar writes, same as Ocean.tsx eases its
    // horizon haze rather than snapping it on a weather change.
    for (let i = 0; i < glowMaterials.length; i++) {
      glowMaterials[i].emissiveIntensity = THREE.MathUtils.damp(
        glowMaterials[i].emissiveIntensity,
        baseGlow[i] * (look.glow / SUNNY_GLOW),
        1.5,
        delta
      );
    }
  });

  const g = layout.geometries;
  const it = layout.items;

  return (
    <group>
      <Seabed islandScale={islandScale} uniforms={uniforms} />

      <ReefFamily geometry={g.pebble} material={materials.pebble} items={it.pebble} />
      <ReefFamily geometry={g.starfish} material={materials.starfish} items={it.starfish} />
      <ReefFamily geometry={g.urchin} material={materials.urchin} items={it.urchin} />

      <ReefFamily geometry={g.brain} material={materials.brain} items={it.brain} />
      <ReefFamily geometry={g.sponge} material={materials.sponge} items={it.sponge} />
      <ReefFamily geometry={g.staghorn} material={materials.staghorn} items={it.staghorn} sway />
      <ReefFamily geometry={g.fan} material={materials.fan} items={it.fan} sway />
      <ReefFamily geometry={g.anemone} material={materials.anemone} items={it.anemone} sway />

      <ReefFamily geometry={g.seagrass} material={materials.seagrass} items={it.seagrass} sway />
      <ReefFamily geometry={g.kelp} material={materials.kelp} items={it.kelp} sway />

      <Bubbles islandScale={islandScale} uniforms={uniforms} rand={layout.rand} />
      <Jellyfish islandScale={islandScale} uniforms={uniforms} rand={layout.rand} />
    </group>
  );
}
