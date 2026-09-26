/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_LIGHT_DECAY, LightingSpec } from '../../constants/lighting';
import { interiorLights } from '../../lib/interiorLights';

/**
 * THE LIGHT A PIECE OF FURNITURE GIVES OFF — one component for every fixture in the game.
 *
 * ## What it replaced
 *
 * A bare `<pointLight intensity={0.6} distance={6} …>` inside each lamp model, twelve of them,
 * every one hard-wired on and answering to nothing. The house has had a working light switch for
 * a while (lib/interiorLights.ts, and the wall plates in Three/LightSwitch.tsx): it drives the
 * ambient light, the sun, the environment map, the exposure, each room's ceiling light, the follow
 * light and the candle in the player's hand, all through one eased `level`. Flip it in a room with
 * four pendants and a sconce in it and the room did not go dark — it went blue, with five lamps
 * still burning inside it, because the fixtures were simply not part of the system.
 *
 * The fix is deliberately NOT a second on/off system for furniture. It is this: one component that
 * reads the SAME `interiorLights.level` everything else already reads, wrapped around the light
 * each model was drawing anyway. A lamp turns off with the room because it is looking at the same
 * number the room is, not because anything told it to.
 *
 * ## The split with the catalog
 *
 * How bright, how far, what colour and whether it is on the house circuit are product data
 * (`ItemDefinition.lighting`, constants/lighting.ts) — free choices, none of them derivable from
 * the geometry. WHERE the bulb sits is not: it is measured against the shade and the arm that hold
 * it, so it stays here, as this component's `position`, next to the model it belongs to.
 *
 * A fixture model therefore contains no lighting logic at all:
 *
 * ```tsx
 * <FixtureLight item={item} position={[0, -0.9, 0]}>
 *   <mesh position={[0, -0.86, 0]}>…the glowing bulb…</mesh>
 * </FixtureLight>
 * ```
 *
 * ## Why the bulb goes inside it
 *
 * Because a lamp that is off is not a lamp with its point light turned down — it is a lamp with a
 * dark bulb. Killing the light while the shade still glows at `emissiveIntensity: 1.7` reads as a
 * broken light rather than an off one, and emissive is unlit by definition, so nothing else in the
 * scene can dim it. Anything passed as a child has its EMISSIVE materials (and only those) scaled
 * with the same level, so the glass goes out with the light it belongs to. Non-emissive children —
 * a shade, a cord, a diffuser tube — pass through untouched, which is what lets a model wrap
 * whatever grouping is convenient rather than having to isolate the one glowing face.
 *
 * ## Outdoors
 *
 * `interiorLights` is the HOUSE's switch, and a `switched` fixture reads it wherever it is drawn.
 * That is safe because every `switched` fixture in the catalog is on the 燈具 shelf, which is
 * `INDOOR` scope (utils/categoryUtils.ts) — it can only ever be put down inside. The one model
 * that is drawn in both worlds (火把 / 部落火把 share TorchModel) is `always`, i.e. a flame with
 * its own fuel, and is not affected either way. A future outdoor fixture that wants to follow
 * something would follow the day/night cycle, which is a different clock and belongs in a
 * different behaviour rather than in an exception here.
 */
/**
 * How bright this material was AUTHORED to glow, recorded on the material itself the first time
 * anyone asks.
 *
 * On the material rather than in the component's own state, and the difference is the whole point:
 * a component's state is lost on every remount and every hot reload, and if the baseline goes with
 * it, whatever the bulb happened to be showing at that moment becomes the new "full brightness".
 * Remount a lamp while the room is dark and its baseline would be captured as 0 — a bulb that can
 * never light again, in a way nothing here could detect. The material outlives all of that, and it
 * is where the authored value already lives.
 *
 * Exactly the idiom `userData.originalOpacity` already uses for the camera-occlusion fade in
 * BuildingInteriorView, for exactly the same reason and against exactly the same failure.
 */
function baseEmissiveOf(mat: THREE.MeshStandardMaterial): number {
  if (mat.userData.fixtureBaseEmissive === undefined) {
    mat.userData.fixtureBaseEmissive = mat.emissiveIntensity ?? 1;
  }
  return mat.userData.fixtureBaseEmissive as number;
}

export function FixtureLight({
  item,
  position,
  children,
}: {
  /** The catalog row this fixture is. Its {@link LightingSpec} is the whole configuration. */
  item?: { lighting?: LightingSpec } | null;
  /** Where the bulb sits in the model's own local frame. */
  position: [number, number, number];
  /** The glowing part of the fixture, if it has one. Emissive materials here follow the switch. */
  children?: React.ReactNode;
}) {
  const spec = item?.lighting;
  const switched = spec?.behaviour === 'switched';

  const lightRef = useRef<THREE.PointLight>(null);
  const glowRef = useRef<THREE.Group>(null);

  /**
   * The emissive materials under `children`.
   *
   * Collected on mount rather than traversed per frame: a decorated room can hold a dozen
   * fixtures, and a traversal each is a per-frame cost for an answer that does not change.
   *
   * The list is a CACHE and nothing more — every value it needs lives on the material itself (see
   * {@link baseEmissiveOf}). That is deliberate: a cache that also holds the only copy of the
   * authored brightness is a cache whose staleness turns into a lamp that can never light up
   * again, and this component runs behind an HMR boundary in dev and a remount-on-reorder in the
   * interior view. Losing the list here costs one traversal; losing the baseline would cost the
   * lamp.
   */
  const glowsRef = useRef<THREE.MeshStandardMaterial[]>([]);

  const collect = () => {
    if (!switched || !glowRef.current) {
      glowsRef.current = [];
      return;
    }
    const found: THREE.MeshStandardMaterial[] = [];
    glowRef.current.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        const m = mat as THREE.MeshStandardMaterial;
        // `emissive` is absent on the basic/unlit materials the effects use, and an emissive of
        // black is a material that does not glow — in both cases there is nothing to turn off.
        // Tested on the COLOUR rather than on the intensity, because the intensity is the very
        // thing this component drives: a fixture collected while its bulb is already dimmed to 0
        // would otherwise fail its own test and drop out of the list for good.
        if (!m || !m.emissive || m.emissive.getHex() === 0) return;
        found.push(m);
      });
    });
    glowsRef.current = found;
  };

  useEffect(collect, [switched]);

  useFrame(() => {
    if (!spec) return;

    // `level` rather than `on`: the switch eases over ~0.7s (lib/interiorLights.ts) and a lamp
    // that cut out instantly while the room faded would read as a bulb blowing, not as a switch.
    // Build mode holds it at 1 for everyone, so a lamp being positioned is a lit lamp.
    const level = switched ? interiorLights.level : 1;

    const light = lightRef.current;
    if (light) {
      // INTENSITY ONLY. This light is never hidden, and that is not an oversight — it is the same
      // rule PlayerFollowLight and CandleGlow follow, written down in Three/InteriorLighting.tsx.
      //
      // three.js compiles「how many point lights are in this scene」into every material's shader
      // (it is part of WebGLPrograms' cache key). So flipping a light's `visible` does not save a
      // light — it changes the scene's light count, and every material being drawn has to be
      // recompiled against the new count. That recompile is the freeze on the frame the switch is
      // flipped, and here it was the worst case in the game: a fixture is the item players place
      // the most of per room, so a decorated room hid SIX point lights at once and recompiled the
      // whole room for it. Measured on tmp-ceiling-light with 6 switched fixtures: 6 program
      // links per toggle with this line, 0 without it.
      //
      // The cost of keeping them is a handful of zero-intensity lights staying in the per-pixel
      // light loop — unmeasurable per frame, and it buys back a visible stall.
      light.intensity = spec.intensity * level;
    }

    if (!switched) return;

    // A fixture with children but an empty list has lost its cache — a hot reload, or a mount
    // ordering where the group was not populated when the effect ran. Re-taking it costs one
    // traversal on the frame it happens, and NOT re-taking it is a bulb that stays lit in a dark
    // room forever, which is invisible from here and obvious to a player.
    if (glowsRef.current.length === 0 && glowRef.current && glowRef.current.children.length > 0) {
      collect();
    }

    // Written every frame, not only when `level` moves.
    //
    // The short-circuit that used to be here compared against the last level THIS component
    // wrote, which silently assumes nothing else ever touches these materials. That assumption is
    // not this component's to make: the interior's own FurnitureItem traverses every placed
    // piece's materials each frame (the camera-occlusion fade), and a material is a shared,
    // mutable object that anything holding the model can reach. If anything does put the authored
    // brightness back while the room is dark, a cached-level guard would never correct it and the
    // lamp would sit there glowing in a room with its lights off. Three float writes per fixture
    // per frame is not a cost worth defending against that.
    for (const mat of glowsRef.current) mat.emissiveIntensity = baseEmissiveOf(mat) * level;
  });

  if (!spec) return <>{children}</>;

  return (
    <>
      <group ref={glowRef}>{children}</group>
      {/*
        No `castShadow`, on every fixture, and it is not an oversight: a shadow-casting point light
        re-renders the scene from six directions every frame, and lamps are the item players place
        the most of per room. Three/Torch.tsx made the same call for the same reason and wrote it
        down first.
      */}
      <pointLight
        ref={lightRef}
        position={position}
        intensity={spec.intensity}
        distance={spec.range}
        decay={spec.decay ?? DEFAULT_LIGHT_DECAY}
        color={spec.color}
      />
    </>
  );
}
