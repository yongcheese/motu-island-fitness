/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';
import {
  MAX_SUBMERGED_TOP_Y,
  WATER_SURFACE_Y,
  seabedY,
} from '../../constants/world';

// Small fish schooling in the shallows around the island. They live *below*
// WATER_SURFACE_Y and are drawn as ordinary opaque meshes, so the translucent
// water planes above them blend over them and tint them automatically - that
// wash is what sells "underwater" without any extra shader work here.
//
// Everything is drawn with two InstancedMeshes (bodies + tail fins) sharing a
// per-fish transform, so a whole shoal costs two draw calls. The tail is a
// separate instance rather than merged geometry purely so it can wag relative
// to the body.

// Tropical palette - deliberately saturated, since roughly half of each fish's
// color is washed out by the water above it before it reaches the camera.
const FISH_COLORS = ['#fb923c', '#fcd34d', '#f472b6', '#67e8f9', '#e2e8f0', '#f87171'];

// --- Proportions. The geometry builders further down are the authority on the
// shape itself; these are the numbers the swimming maths also has to know. ---

// Nose-to-peduncle length of the body mesh. The caudal fin mounts at the back
// of it and adds roughly another third on top, so a fish reads a little longer
// than this number alone suggests.
const BODY_LENGTH = 0.4;

// Where the caudal fin pivots - just inside the back of the body, so the joint
// stays buried instead of opening a seam when the tail swings.
const TAIL_JOINT_Z = -BODY_LENGTH / 2 + 0.01;

// Highest point of the silhouette above the body's centre line: the dorsal fin
// tip, not the back itself.
const FISH_HALF_HEIGHT = 0.17;

// Per-fish scale spread, and the vertical scatter/bob each fish rides on top of
// its school's shared depth.
const MIN_FISH_SIZE = 0.8;
const MAX_FISH_SIZE = 1.2;
const DEPTH_JITTER = 0.18;
const BOB_AMPLITUDE = 0.09;

// The shallowest a school may sit before the tallest fish riding the top of its
// jitter would break through the wave trough. Deriving it rather than
// hand-tuning each depth is what stops the shoal from surfacing the next time
// the fish are resized - which is exactly what enlarging them did to the
// hand-tuned depths this replaced. The ceiling itself now lives in
// constants/world.ts, shared with the reef, which is fitted under the same line.
const MAX_SCHOOL_DEPTH =
  MAX_SUBMERGED_TOP_Y - DEPTH_JITTER - BOB_AMPLITUDE - FISH_HALF_HEIGHT * MAX_FISH_SIZE;

// Fish orbit the island in loose bands. Each school shares a radius/depth/
// direction so they read as a group moving together, and individual fish only
// jitter around that shared path. Depths are expressed as a distance *below
// the water surface* rather than as absolute world Y, so the shoal follows the
// sea if the waterline ever moves - a fish is only a fish while it's under it.
const SCHOOLS = [
  { radiusOffset: 2.0, speed: 0.10, depth: Math.min(WATER_SURFACE_Y - 0.7, MAX_SCHOOL_DEPTH) },
  { radiusOffset: 4.6, speed: -0.075, depth: Math.min(WATER_SURFACE_Y - 1.05, MAX_SCHOOL_DEPTH) },
  { radiusOffset: 7.2, speed: 0.055, depth: Math.min(WATER_SURFACE_Y - 0.88, MAX_SCHOOL_DEPTH) },
  { radiusOffset: 9.6, speed: -0.045, depth: Math.min(WATER_SURFACE_Y - 1.25, MAX_SCHOOL_DEPTH) },
];

// Coast radius at territory level 1 - mirrors Ocean.tsx's uCoastRadius and
// Island.tsx's sand edge, and is scaled by islandScale below so the shoals
// stay just off the beach as the island grows instead of ending up inland.
const COAST_RADIUS = 6.8;

// A fish is seen through *two* translucent layers - the ocean surface and the
// painted reflection smear beneath it (see Ocean.tsx) - which between them eat
// well over half of its shaded color. A plain lit material comes out muddy
// under that, so each fish is given a little self-lit glow on top of its
// normal shading to keep its color readable through the water. `totalEmissiveRadiance *= vColor` is the patch
// that makes that glow follow the per-instance color: three multiplies the
// instance color into the diffuse term only, leaving emissive a single shared
// color, which would flatten every fish toward the same washed white.
function createFishMaterial() {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.05,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.35,
    flatShading: true,
    // Required for the per-instance color to reach the fragment shader at all.
    // three (0.184) defines USE_INSTANCING_COLOR only in the *vertex* prefix, so
    // color_pars_fragment - which gates `varying vec4 vColor` on USE_COLOR /
    // USE_COLOR_ALPHA - never declares it for an instanced-color-only material.
    // Without this the patch below referenced an undeclared identifier, the
    // program failed to link, and the entire shoal silently vanished; even had
    // it linked, color_fragment gates `diffuseColor *= vColor` the same way, so
    // the per-fish colors would have been dropped too. Setting vertexColors
    // defines USE_COLOR in both prefixes, which fixes both halves at once. See
    // createFishGeometry for the white color attribute this requires.
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      // .rgb, not the bare varying: vColor is a vec4 here and
      // totalEmissiveRadiance is a vec3, which is itself a compile error.
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'
    );
  };
  return material;
}

// vertexColors makes three declare `attribute vec3 color` and multiply it into
// vColor before the instance color is applied. A geometry without that
// attribute leaves it unbound, and WebGL feeds unbound attributes (0,0,0) - so
// every fish would come out black. Flat white makes the per-vertex term a
// no-op and lets instanceColor alone decide the fish's color.
function withWhiteVertexColors(geometry: THREE.BufferGeometry) {
  const white = new Float32Array(geometry.attributes.position.count * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));
  return geometry;
}

function createBody() {
  // Fusiform profile revolved around the axis: pointed snout, widest a little
  // forward of centre, tapering to a thin caudal peduncle. This used to be a
  // single 6-sided cone, which reads as a spike from every angle - the taper on
  // both ends is what actually makes the silhouette say "fish" at this size.
  const half = BODY_LENGTH / 2;
  const profile = [
    new THREE.Vector2(0.0, -half - 0.004), // cap, so the peduncle isn't an open ring
    new THREE.Vector2(0.012, -half),
    new THREE.Vector2(0.03, -half * 0.68),
    new THREE.Vector2(0.052, -half * 0.32),
    new THREE.Vector2(0.07, -half * 0.02),
    new THREE.Vector2(0.075, half * 0.2), // widest point
    new THREE.Vector2(0.064, half * 0.5),
    new THREE.Vector2(0.04, half * 0.78),
    new THREE.Vector2(0.0, half), // snout
  ];
  const body = new THREE.LatheGeometry(profile, 12);
  // Lathe revolves around +Y; point the nose at +Z, the direction the instance
  // transform below treats as "forward".
  body.rotateX(Math.PI / 2);
  // Fish are compressed side-to-side and deep top-to-bottom. Applied to the
  // body alone - the fins below are already modelled at final proportions.
  body.scale(0.72, 1.15, 1);
  return body;
}

// All three fins are 3-sided cones squashed into blades. Cheaper than extruded
// shapes, and the facets match the body's own under flatShading rather than
// introducing a second, smoother visual language.
function createDorsalFin() {
  const fin = new THREE.ConeGeometry(0.05, 0.085, 3);
  fin.translate(0, 0.0425, 0); // base to the origin, so the height below is absolute
  fin.scale(0.16, 1, 1.7); // thin across the body, stretched fore-aft
  fin.translate(0, 0.082, -0.01); // sunk slightly into the back, no gap at the root
  return fin;
}

function createPectoralFin(side: number) {
  const fin = new THREE.ConeGeometry(0.032, 0.075, 3);
  fin.translate(0, 0.0375, 0);
  fin.scale(0.22, 1, 1.25); // flattened into a paddle *before* it is swung outward
  fin.rotateZ(side * -(Math.PI / 2 + 0.25)); // out to the flank, angled slightly down
  fin.rotateY(side * 0.35); // sweep the tip aft, as if held against the current
  fin.translate(side * 0.04, -0.01, 0.045);
  return fin;
}

function createFishGeometry() {
  // Body and fins merge into one buffer so the whole shoal still costs a single
  // draw call - the fins never move relative to the body, so there is nothing
  // to gain from keeping them separate.
  return withWhiteVertexColors(
    mergeGeometries([createBody(), createDorsalFin(), createPectoralFin(1), createPectoralFin(-1)])
  );
}

function createTailGeometry() {
  // Forked caudal fin - two blades splayed off a shared joint at the origin, so
  // the wag rotation in useFrame pivots where the fin actually meets the body.
  const lobe = (dir: number) => {
    const l = new THREE.ConeGeometry(0.05, 0.145, 3);
    l.translate(0, 0.0725, 0);
    l.scale(0.2, 1, 0.55);
    // Local +Y becomes -Z here, so the blade points aft; the extra dir term
    // splays one lobe up and the other down into the fork.
    l.rotateX(-Math.PI / 2 + dir * 0.5);
    return l;
  };
  return withWhiteVertexColors(mergeGeometries([lobe(1), lobe(-1)]));
}

export function Fish({ count = 28 }: { count?: number }) {
  const { profile, weather } = useAppPick('profile', 'weather');
  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4;

  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const tailRef = useRef<THREE.InstancedMesh>(null);
  // Lerped, not snapped, so a weather change eases the shoal down/up instead
  // of teleporting it - matches how Ocean/SkyDome ease their own transitions.
  const depthOffset = useRef(0);

  const bodyGeometry = useMemo(() => createFishGeometry(), []);
  const tailGeometry = useMemo(() => createTailGeometry(), []);
  // One material for both meshes - the tail is the same fish, just a
  // separately-transformed piece of it.
  const material = useMemo(() => createFishMaterial(), []);

  const fishes = useMemo(() => {
    // Deterministic-enough per-fish jitter, generated once. Each entry is a
    // fixed offset from its school's shared path.
    return Array.from({ length: count }, (_, i) => {
      const school = SCHOOLS[i % SCHOOLS.length];
      return {
        school,
        angle0: Math.random() * Math.PI * 2,
        // Fish in the same school clump together in a short arc rather than
        // spreading evenly around the whole ring.
        dAngle: (Math.random() - 0.5) * 0.5,
        dRadius: (Math.random() - 0.5) * 1.8,
        dDepth: (Math.random() - 0.5) * 2 * DEPTH_JITTER,
        phase: Math.random() * Math.PI * 2,
        size: MIN_FISH_SIZE + Math.random() * (MAX_FISH_SIZE - MIN_FISH_SIZE),
        color: new THREE.Color(FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)]),
      };
    });
  }, [count]);

  // Scratch objects reused every frame - allocating matrices per fish per
  // frame would churn the GC hard at 60fps.
  const scratch = useMemo(
    () => ({
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      bodyMatrix: new THREE.Matrix4(),
      tailMatrix: new THREE.Matrix4(),
      tailLocal: new THREE.Matrix4(),
      tailWag: new THREE.Matrix4(),
      yAxis: new THREE.Vector3(0, 1, 0),
    }),
    []
  );

  useFrame((state, delta) => {
    const body = bodyRef.current;
    const tail = tailRef.current;
    if (!body || !tail) return;

    const t = state.clock.getElapsedTime();
    const coastRadius = COAST_RADIUS * islandScale;
    // The submerged foot of the sand slope reaches ~1.04x the coast radius and
    // grows with islandScale, while the school offsets below are fixed - so at
    // high territory levels the innermost school would eventually be swallowed
    // by the beach. This floor keeps every fish just clear of it at any size.
    const minRadius = coastRadius * 1.09;

    // In rough weather the shoal drops away from the churned-up surface; in
    // calm weather it drifts back up into the bright shallows.
    const targetDepth =
      weather === WeatherType.STORM ? -0.55 : weather === WeatherType.RAINY ? -0.25 : 0;
    depthOffset.current = THREE.MathUtils.damp(depthOffset.current, targetDepth, 1.2, delta);

    for (let i = 0; i < fishes.length; i++) {
      const f = fishes[i];

      const angle = f.angle0 + f.dAngle + t * f.school.speed + Math.sin(t * 0.6 + f.phase) * 0.05;
      const radius = Math.max(
        minRadius,
        coastRadius + f.school.radiusOffset + f.dRadius + Math.sin(t * 0.8 + f.phase) * 0.4
      );
      // There is a real sea floor under the shoal now (see OceanDecorations), so
      // a school's depth is no longer the whole story: the innermost band swims
      // over water barely a metre deep, and in rough weather `depthOffset` used
      // to push it straight down through the sand. Clamping against the same
      // profile the reef is built from keeps every fish above the floor at any
      // radius and in any weather - and has the pleasant side effect of making
      // the inshore school hug the bottom as the shallows squeeze it.
      const floorY = seabedY(radius, islandScale) + FISH_HALF_HEIGHT * f.size + 0.05;
      const y = Math.max(
        floorY,
        f.school.depth +
          f.dDepth +
          depthOffset.current +
          Math.sin(t * 1.1 + f.phase) * BOB_AMPLITUDE
      );

      scratch.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

      // Face along the direction of travel: the tangent to the orbit, flipped
      // for schools swimming the other way round the island. atan2(x, z)
      // (not the usual z, x) because the model's nose points +Z.
      const dir = Math.sign(f.school.speed);
      const heading =
        Math.atan2(-Math.sin(angle) * dir, Math.cos(angle) * dir) +
        Math.sin(t * 2.2 + f.phase) * 0.12; // gentle weave off the perfect circle

      scratch.quaternion.setFromAxisAngle(scratch.yAxis, heading);
      scratch.scale.setScalar(f.size);
      scratch.bodyMatrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      body.setMatrixAt(i, scratch.bodyMatrix);

      // Tail rides at the back of the body and wags about that joint. Built
      // as body * offset * wag so it inherits the body's own uniform scale.
      scratch.tailWag.makeRotationY(Math.sin(t * 6 + f.phase) * 0.45);
      scratch.tailLocal.makeTranslation(0, 0, TAIL_JOINT_Z).multiply(scratch.tailWag);
      scratch.tailMatrix.multiplyMatrices(scratch.bodyMatrix, scratch.tailLocal);
      tail.setMatrixAt(i, scratch.tailMatrix);
    }

    body.instanceMatrix.needsUpdate = true;
    tail.instanceMatrix.needsUpdate = true;
  });

  // Colors are per-instance and never change, so they're written once after
  // mount rather than every frame alongside the matrices.
  useEffect(() => {
    for (const mesh of [bodyRef.current, tailRef.current]) {
      if (!mesh) continue;
      for (let i = 0; i < fishes.length; i++) mesh.setColorAt(i, fishes[i].color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [fishes]);

  return (
    <group>
      {/* frustumCulled is off on both: an InstancedMesh derives its bounding
          sphere from the geometry sitting at the origin, so with every fish
          transformed out to the coastline the whole shoal would pop out of
          existence whenever the origin left the view. */}
      <instancedMesh ref={bodyRef} args={[bodyGeometry, material, count]} frustumCulled={false} />

      {/* Fully opaque, like the body: a transparent fin would be sorted into
          the same pass as the ocean planes and could end up drawn over the
          water instead of beneath it. */}
      <instancedMesh ref={tailRef} args={[tailGeometry, material, count]} frustumCulled={false} />
    </group>
  );
}
