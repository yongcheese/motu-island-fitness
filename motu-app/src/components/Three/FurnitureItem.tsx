import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedItem, ItemCategory } from '../../types';
import { ALL_ITEMS } from '../../constants/items';
import { landscapeScaleOf } from '../../constants/outdoorScale';
import type { FurnitureModelId } from '../../constants/furnitureModels';
import { getArtworkSpec } from '../../constants/artwork';
import { DECAL_DEPTH_BIAS, SURFACE_DECAL_LIFT } from '../../constants/terrain';
import {
  OUT_CANVAS, OUT_CANVAS_DARK, OUT_DRY, OUT_LEAF, OUT_LEAF_DARK, OUT_LEAF_LIGHT,
  OUT_CHARRED, OUT_STONE, OUT_STONE_DARK, OUT_STONE_LIGHT, OUT_WATER, OUT_WATER_DARK, OUT_WATER_LIGHT,
  OUT_METAL, OUT_METAL_DARK, OUT_WOOD, OUT_WOOD_DARK, OUT_WOOD_LIGHT, OUT_WOOD_SHADOW,
  OUT_BLOSSOM_PINK, OUT_BLOSSOM_PINK_DARK, OUT_BLOSSOM_WHITE, OUT_FLOWER_RED, OUT_FLOWER_YELLOW,
  OUT_FLOWER_PURPLE, OUT_FRUIT, OUT_FRUIT_DARK, OUT_MUSHROOM_CAP, OUT_MUSHROOM_STEM,
} from '../../constants/outdoorPalette';
import {
  SUSPENDED_MOTIONS, WIND_NODES, WIND_ROTORS,
} from '../../constants/outdoorAnimation';
import {
  type WindSample, suspendedAngle, suspendedPhase, suspendedSag, sampleWind,
} from '../../lib/outdoorMotion';
import {
  WaterFalls, WaterJet, WaterRipples,
  useFurnitureOccupancy, useOutdoorAnimation, useWindRig, useWindRotor,
} from './outdoorAnimation';
import {
  BurnerFlames, GlowPanel, ObjectBurst, ObjectToss, SoundWaves, SteamWisps, WaterStream, WaterSwirl,
  useObjectAnimation,
} from './objectAnimation';
import { ArtworkModel } from './ArtworkModels';
import { FixtureLight } from './FixtureLight';
import { FlameCore, Torch } from './Torch';
import { playSwingCreak, playFurnitureCreak } from '../../lib/soundUtils';

interface FurnitureModelProps {
  scale: number;
  item?: any;
  /**
   * Placement instance id (see PlacedItem in types.ts), only passed for items rendered by
   * PlacementGhost's IslandPlacements() - not the drag-preview ghost, and not the legacy
   * equipped-buildings renderer. Lets a specific placed instance's model listen for the
   * 'furniture-interact' CustomEvent (dispatched by Avatar.tsx when the player triggers the
   * nearest interactable) and react only to itself, so placing two of the same decoration
   * doesn't make both play their interaction animation at once. Components that don't need
   * interactivity simply ignore this extra prop.
   */
  instanceId?: string;
}

/*
 * HOW A PIECE OF FURNITURE REACTS TO BEING USED — see Three/objectAnimation.tsx's
 * `useObjectAnimation` and its table, constants/objectAnimations.ts.
 *
 * This file used to also export `useFurnitureTrigger`: a hook that stamped a timestamp on every
 * 'furniture-interact' and left each model to derive its own animation from 「seconds since the
 * press」. Four outdoor pieces (營火, 望遠鏡, 鳥屋, 許願井) were still built on it, each with its
 * own `useFrame` running unculled for the whole session and its own boost-and-lerp. They are rows
 * in the shared table now, so the hook had no callers left and is gone — which is also what stops
 * a fifth piece reaching for it.
 */

/**
 * 科技馬桶 —— 沖水, which needed the one thing the model did not have: a bowl.
 *
 * The seat used to be a solid 0.55 × 0.06 × 0.7 slab, so there was nothing for water to be in.
 * It is now FOUR bars forming a ring with the same outer footprint to the millimetre — x ±0.275,
 * z -0.30..0.40, y 0.50..0.56 — so the measured collider is byte-for-byte what it was, and there
 * is now an opening with water under it.
 *
 * ## The half of that change that was missed, and what it looked like
 *
 * Opening the SEAT was only half a bowl. The pedestal under it stayed a solid
 * 0.6 × 0.5 × 0.9 box topping out at y = 0.50, so what the new opening exposed was that box's
 * lid — and the water disc was drawn with its own top face at exactly 0.50 as well. Two opaque
 * up-facing surfaces, coplanar to the millimetre, covering 0.09 m² of each other: the classic
 * depth-buffer speckle, and `npm run audit:zfighting` had been reporting it as its single
 * worst finding. On top of the flicker, the "water" was a lid painted on a block rather than
 * anything in a container, so the toilet read as filled to the brim.
 *
 * The pedestal is now a SHELL, by the same rule the model's own note above states and the same
 * one the bathtub and the microwave follow: five pieces whose union has the IDENTICAL outer
 * extent (x ±0.30, y 0.00..0.50, z ±0.45), so every measured collider, footprint and stand
 * height is unchanged, and there is now a cavity. The water sits 10 cm down inside it, where
 * water in a bowl is, and no two faces share a plane.
 */
function ToiletModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  /**
   * The pedestal, as a shell around the bowl cavity.
   *
   * The cavity is the seat ring's own opening (x ±0.15, z -0.16..0.26) taken straight down to
   * y = 0.22, so what you see through the ring is the inside of a bowl rather than a lid. The
   * five slabs tile the old box exactly — floor + back + front + two sides — which is what keeps
   * `measureFootprint` (and therefore the collider, the placement rules and the shop icon's
   * reference box) byte-for-byte what it was.
   */
  const BOWL = { minX: -0.15, maxX: 0.15, minZ: -0.16, maxZ: 0.26, floorY: 0.22 } as const;
  const pedestal: { p: [number, number, number]; s: [number, number, number] }[] = [
    // Floor of the pedestal, full width, up to the bowl's bottom.
    { p: [0, BOWL.floorY / 2, 0], s: [0.6, BOWL.floorY, 0.9] },
    // Back and front walls, spanning the full width between the bowl and the outer faces.
    { p: [0, 0.36, (BOWL.minZ - 0.45) / 2], s: [0.6, 0.28, BOWL.minZ + 0.45] },
    { p: [0, 0.36, (BOWL.maxZ + 0.45) / 2], s: [0.6, 0.28, 0.45 - BOWL.maxZ] },
    // Side walls, only as deep as the bowl so they do not double up with the two above.
    { p: [(BOWL.minX - 0.3) / 2, 0.36, (BOWL.minZ + BOWL.maxZ) / 2], s: [BOWL.minX + 0.3, 0.28, BOWL.maxZ - BOWL.minZ] },
    { p: [(BOWL.maxX + 0.3) / 2, 0.36, (BOWL.minZ + BOWL.maxZ) / 2], s: [0.3 - BOWL.maxX, 0.28, BOWL.maxZ - BOWL.minZ] },
  ];
  return (
    <group ref={anim.root} scale={scale}>
      {/* Base — five slabs, one box's worth of extent. See `pedestal` above. */}
      {pedestal.map((part, i) => (
        <mesh key={`ped-${i}`} position={part.p} castShadow receiveShadow>
          <boxGeometry args={part.s} />
          <meshStandardMaterial color="#f8fafc" roughness={0.1} />
        </mesh>
      ))}
      {/* The water, down in the bowl — 10 cm below the rim, and 6 cm above its floor, so
          neither of its faces shares a plane with anything. */}
      <mesh position={[0, 0.265, 0.05]}>
        <cylinderGeometry args={[0.14, 0.12, 0.03, 14]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.7} roughness={0.05} />
      </mesh>
      {anim.active && <WaterSwirl at={[0, 0.282, 0.05]} radius={0.135} />}
      {/* Seat ring — four bars, same outer box as the slab they replaced. */}
      {[
        { p: [0, 0.53, 0.33] as [number, number, number], s: [0.55, 0.06, 0.14] as [number, number, number] },
        { p: [0, 0.53, -0.23] as [number, number, number], s: [0.55, 0.06, 0.14] as [number, number, number] },
        { p: [-0.2125, 0.53, 0.05] as [number, number, number], s: [0.125, 0.06, 0.42] as [number, number, number] },
        { p: [0.2125, 0.53, 0.05] as [number, number, number], s: [0.125, 0.06, 0.42] as [number, number, number] },
      ].map((bar, i) => (
        <mesh key={`seat-${i}`} position={bar.p} castShadow>
          <boxGeometry args={bar.s} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.2} />
        </mesh>
      ))}
      {/* Water Tank. Sits 2cm above the seat cover's underside rather than
          exactly level with it — both are downward faces, so level meant one
          shared plane and speckle wherever they overlap. */}
      <mesh position={[0, 0.87, -0.32]} castShadow>
        <boxGeometry args={[0.65, 0.7, 0.3]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.1} />
      </mesh>
      {/* Flush Button, pressed in on a `pulse` as the hand reaches it. */}
      <group position={[0.2, 1.1, -0.32]} ref={anim.ref('flushButton')}>
        <mesh>
          <boxGeometry args={[0.1, 0.05, 0.1]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 大理石洗手台 —— 水龍頭開啟 → 水流出現 → 關閉後水流停止.
 *
 * The tap was a bare 0.25-long cylinder with no spout, no lever and nowhere for water to come
 * out; a `wash` posture played beside it was a person miming at a post. It now has the three
 * parts that make a tap — a spout reaching over the basin, a lever that tips, and (for the 2.8
 * seconds the `washbasin` row runs) an actual stream landing in the bowl.
 *
 * `run`, not `toggle`: see that row for why a tap that could be left on is both a worse picture
 * and a worse citizen.
 */
function WashbasinModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Wood Cabinet support */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.9, 0.8]} />
        <meshStandardMaterial color="#78350f" roughness={0.6} />
      </mesh>
      {/* Marble Basin counter */}
      <mesh position={[0, 0.93, 0]} castShadow>
        <boxGeometry args={[1.24, 0.08, 0.84]} />
        <meshStandardMaterial color="#fafafa" roughness={0.2} />
      </mesh>
      {/* The bowl: a recessed disc and its rim, so the water has somewhere to land. */}
      <mesh position={[0, 0.9755, 0.02]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.27, 18]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} {...DECAL_DEPTH_BIAS} />
      </mesh>
      <mesh position={[0, 0.977, 0.02]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.27, 0.30, 20]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.25} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {anim.active && (
        <WaterStream from={[0, 1.145, -0.02]} landY={0.978} width={0.017} count={3} />
      )}
      {/* Mirror */}
      <mesh position={[0, 1.8, -0.38]} castShadow>
        <boxGeometry args={[0.9, 1.0, 0.05]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.05} />
      </mesh>
      {/* Mirror wood Frame */}
      <mesh position={[0, 1.8, -0.41]} castShadow>
        <boxGeometry args={[1.0, 1.1, 0.04]} />
        <meshStandardMaterial color="#451a03" />
      </mesh>
      {/* Faucet: riser, a spout reaching out over the bowl, and the lever on top. */}
      <mesh position={[0, 1.08, -0.2]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.25, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.1} />
      </mesh>
      <mesh position={[0, 1.19, -0.11]} castShadow>
        <boxGeometry args={[0.05, 0.045, 0.2]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.1} />
      </mesh>
      <mesh position={[0, 1.155, -0.02]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, 0.05, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.1} />
      </mesh>
      <group position={[0, 1.215, -0.2]} ref={anim.ref('tapLever')}>
        <mesh position={[0, 0.012, 0.055]} castShadow>
          <boxGeometry args={[0.028, 0.028, 0.13]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.75} roughness={0.15} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * A tub with an INSIDE.
 *
 * It used to be one solid 2.0 x 0.8 x 1.2 box with a thin blue slab floating on top of it, which
 * was fine for as long as nothing ever went into it — and it is exactly why 泡澡 could only ever
 * be performed standing beside the piece. A character lowered into that shape would have been
 * inside solid white geometry, i.e. invisible.
 *
 * So: a floor slab and four walls, whose union has the SAME outer extent as the box it replaces
 * (x +/-1.0, y 0..0.8, z +/-0.6). Every collider in the game is measured off the model
 * (lib/furniturePlacement.ts), so keeping the extent identical means nothing about where this
 * piece can be placed, or what the player walks into, changes at all — the only thing that
 * changed is that there is now a cavity for a body.
 *
 * The interior floor's top face (y 0.16 model, 0.202 as drawn) is what the bathe anchor in
 * constants/items.ts states as its `surfaceY`, and `npm run audit:interactions` checks the body
 * against these very meshes.
 */
function BathtubModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  // Named rather than repeated, because the anchor in the catalog is derived from them and a
  // silent edit to one of these is exactly the kind of drift the audit exists to catch.
  const WALL = 0.1;
  const FLOOR_TOP = 0.16;
  const RIM = 0.8;
  const WALL_H = RIM - FLOOR_TOP;
  return (
    <group ref={anim.root} scale={scale * 1.1}>
      {/* Interior floor — the surface the bather sits on */}
      <mesh position={[0, FLOOR_TOP / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.0, FLOOR_TOP, 1.2]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.1} />
      </mesh>
      {/* End walls */}
      {[-1, 1].map((side) => (
        <mesh key={`end${side}`} position={[side * (1.0 - WALL / 2), FLOOR_TOP + WALL_H / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[WALL, WALL_H, 1.2]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.1} />
        </mesh>
      ))}
      {/* Long walls, inset so they meet the end walls rather than overlapping them */}
      {[-1, 1].map((side) => (
        <mesh key={`side${side}`} position={[0, FLOOR_TOP + WALL_H / 2, side * (0.6 - WALL / 2)]} castShadow receiveShadow>
          <boxGeometry args={[2.0 - WALL * 2, WALL_H, WALL]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.1} />
        </mesh>
      ))}
      {/*
        Water, now filling the cavity instead of resting on a lid — and RISING when somebody
        gets in, which is the one piece of physics everybody knows and nobody animates.

        Two nested groups because the two motions are different things: `water` lifts the whole
        body of it (displacement), `surface` rolls it a fraction of a degree (the slop). Both are
        driven by the `bathtub` row's `occupied` signal, eased over the same 0.8 s the character
        controller takes to lower the body into the tub — so nothing has to be synchronised,
        because nothing is separately timed.
      */}
      <group position={[0, (FLOOR_TOP + 0.62) / 2, 0]} ref={anim.ref('water')}>
        <group ref={anim.ref('surface')}>
          {/* `noCollide`: water is what the bather sits IN, not matter they collide with — the
              same flag every drawn effect carries, so neither the collider nor
              `npm run audit:interactions` reads a body in the bath as a body through the tub. */}
          <mesh userData={{ noCollide: true }}>
            <boxGeometry args={[2.0 - WALL * 2, 0.62 - FLOOR_TOP, 1.2 - WALL * 2]} />
            <meshStandardMaterial color="#38bdf8" transparent opacity={0.55} roughness={0.01} />
          </mesh>
        </group>
      </group>
      {anim.active && (
        <>
          <WaterRipples
            surfaces={[{ at: [-0.45, 0.625, 0], radius: 0.42 }, { at: [0.5, 0.625, 0], radius: 0.34 }]}
            count={2}
            rate={0.42}
          />
          <SteamWisps at={[0.3, 0.66, 0]} rise={0.5} spread={0.24} count={5} size={0.036} />
        </>
      )}
      {/* Faucet hardware */}
      <mesh position={[0.9, 0.9, 0]} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

function KitchenCounterModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* White Cabinet Base */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.9, 0.85]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>
      {/* Stainless Steel top */}
      <mesh position={[0, 0.93, 0]} castShadow>
        <boxGeometry args={[1.64, 0.06, 0.89]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.2} />
      </mesh>
      {/* Sink depression sink effect */}
      <mesh position={[-0.3, 0.97, 0]} castShadow>
        <boxGeometry args={[0.6, 0.02, 0.5]} />
        <meshStandardMaterial color="#475569" roughness={0.1} />
      </mesh>
      {/* Silver faucet */}
      <mesh position={[-0.3, 1.15, -0.2]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

/**
 * 雙開門冰箱 —— two leaves hinged on the SAME stile, which is what a fridge with both handles
 * on one side actually is.
 *
 * Each leaf is a `<group>` at x = -0.43 (the body's own left edge, where the hinges would be) with
 * the leaf and its handle offset back to where they were drawn. The freezer leads by a beat and
 * the main door follows — constants/objectAnimations.ts's `fridge` row does the staggering with
 * one `range`, so there is no second timeline.
 *
 * `momentary`: it swings open, holds for two and a half seconds, and shuts itself. Nobody has to
 * remember to close a fridge, and there is no state in which it can be found half open.
 */
function FridgeModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale * 1.1}>
      {/* Main Body */}
      <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 2.0, 0.9]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.3} />
      </mesh>
      {/* The cold interior, mounted only while a door is open — so a shut fridge draws none of
          it, and the build-time measurement (which never runs the state) always sizes the piece
          by its closed shell. */}
      {anim.active && (
        <group position={[0, 0, 0.452]}>
          <GlowPanel position={[0, 1.0, 0]} size={[0.84, 1.94]} color="#e8f6ff" intensity={0.9} cast={0.35} />
          {/* Three shelves and something on each, so the cavity reads as a fridge rather than as
              a lit rectangle. */}
          {[0.42, 0.72, 1.02].map((y, i) => (
            <React.Fragment key={`shelf-${i}`}>
              <mesh position={[0, y, 0.012]}>
                <boxGeometry args={[0.8, 0.014, 0.02]} />
                <meshStandardMaterial color="#dbeafe" transparent opacity={0.7} roughness={0.2} />
              </mesh>
              <mesh position={[(i - 1) * 0.2, y + 0.07, 0.02]}>
                <boxGeometry args={[0.1, 0.13, 0.02]} />
                <meshStandardMaterial
                  color={['#8fa9a2', '#e8c37a', '#c9836f'][i]}
                  roughness={0.8}
                />
              </mesh>
            </React.Fragment>
          ))}
        </group>
      )}
      {/* Top Freezer Door, hinged on the body's -X edge. */}
      <group position={[-0.43, 1.45, 0.46]} ref={anim.ref('doorFreezer')}>
        <mesh position={[0.43, 0, 0]} castShadow>
          <boxGeometry args={[0.86, 0.8, 0.06]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.2} />
        </mesh>
        <mesh position={[0.78, -0.25, 0.06]} castShadow>
          <boxGeometry args={[0.04, 0.3, 0.04]} />
          <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
      {/* Bottom Fridge Door. Lifted 1cm off the floor so its underside is not
          on the same plane as the body's — a real fridge door has that gap. */}
      <group position={[-0.43, 0.51, 0.46]} ref={anim.ref('doorFridge')}>
        <mesh position={[0.43, 0, 0]} castShadow>
          <boxGeometry args={[0.86, 1.0, 0.06]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.2} />
        </mesh>
        <mesh position={[0.78, 0.09, 0.06]} castShadow>
          <boxGeometry args={[0.04, 0.4, 0.04]} />
          <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 嵌入式瓦斯爐 —— the second piece the brief leads with, and the one whose OLD state was the
 * clearest statement of the problem.
 *
 * It shipped with two cyan emissive tori sitting on the burners, at `emissiveIntensity={3}`,
 * permanently. That is a hob that is always alight and never lights: the one visual an unlit hob
 * must not have, and the one thing a lit hob must do. They are now the burner CROWNS — the dark
 * cast-iron rings a real hob has — and the fire is `<BurnerFlames>`, mounted only while the stove
 * is on.
 *
 * `BURNERS` is the single source of the two burner centres: the crowns are drawn from it and the
 * flames are handed it, so 「火焰應從 Burner 正確產生、不要漂浮在空中或從中央冒出來」 cannot
 * drift — there is no second copy of those numbers to get out of step with the first.
 *
 * ON/OFF is `toggle` in constants/objectAnimations.ts: press E to light it, press E again to put
 * it out, and walking away does neither. It is one of exactly two pieces in the game with
 * persistent state, and lib/objectRuntimeState.ts explains why that state deliberately stops at
 * the session rather than reaching the save file.
 */
const STOVE_BURNERS: readonly (readonly [number, number, number])[] = [
  [-0.3, 0.96, 0],
  [0.3, 0.96, 0],
];

/** One hob control, with the pointer that makes its quarter-turn readable at all. */
function StoveKnob() {
  return (
    <>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.04, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.03, 0.022]}>
        <boxGeometry args={[0.011, 0.038, 0.008]} />
        <meshStandardMaterial color="#0f172a" roughness={0.6} />
      </mesh>
    </>
  );
}

function StoveModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Base Stove body */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.9, 0.8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.4} />
      </mesh>
      {/* Top Burner surface */}
      <mesh position={[0, 0.92, 0]} castShadow>
        <boxGeometry args={[1.22, 0.04, 0.82]} />
        <meshStandardMaterial color="#0f172a" roughness={0.2} />
      </mesh>
      {STOVE_BURNERS.map((c, i) => (
        <React.Fragment key={`burner-${i}`}>
          {/* Pan support. */}
          <mesh position={[c[0], c[1] - 0.01, c[2]]}>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 16]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          {/* The crown the gas comes out of. Dark cast iron when it is out — which, unlike the
              cyan ring this replaced, is what an unlit burner looks like. */}
          <mesh position={[c[0], c[1] + 0.012, c[2]]}>
            <torusGeometry args={[0.12, 0.02, 8, 16]} />
            <meshStandardMaterial color="#243244" roughness={0.55} metalness={0.35} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Control knobs on the fascia, turned a quarter by the `stove` row while it is lit.
          Written out rather than mapped, so `anim.ref('knobLeft')` is greppable from the row that
          names it — the join between this file and the catalog is two strings and nothing
          type-checks it, so `npm run audit:object-animations` reads them both as TEXT. A name
          assembled at runtime is a name the audit cannot see. */}
      <group position={[-0.3, 0.78, 0.41]} ref={anim.ref('knobLeft')}>
        <StoveKnob />
      </group>
      <group position={[0.3, 0.78, 0.41]} ref={anim.ref('knobRight')}>
        <StoveKnob />
      </group>
      {anim.active && <BurnerFlames at={STOVE_BURNERS} />}
    </group>
  );
}

function HangingCabinetModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 1.8, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.6, 0.4]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>
      {/* Glass Sliding doors */}
      <mesh position={[-0.32, 1.8, 0.41]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" transparent opacity={0.6} roughness={0.1} />
      </mesh>
      <mesh position={[0.32, 1.8, 0.42]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" transparent opacity={0.6} roughness={0.1} />
      </mesh>
    </group>
  );
}

/** 橡木書桌 —— 閱讀: the cover of the top book on the pile lifts and its pages riffle. */
function DeskModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Wood Desktop */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.08, 0.9]} />
        <meshStandardMaterial color="#b45309" roughness={0.4} />
      </mesh>
      {/* Left Drawer Support */}
      <mesh position={[-0.7, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.35, 0.7, 0.85]} />
        <meshStandardMaterial color="#78350f" roughness={0.5} />
      </mesh>
      {/* Right support pillar */}
      <mesh position={[0.7, 0.35, 0]} castShadow>
        <boxGeometry args={[0.1, 0.7, 0.85]} />
        <meshStandardMaterial color="#451a03" />
      </mesh>
      {/* Desktop small book pile */}
      <mesh position={[-0.6, 0.84, 0.2]} castShadow>
        <boxGeometry args={[0.3, 0.1, 0.4]} />
        <meshStandardMaterial color="#1e3a8a" />
      </mesh>
      <mesh position={[-0.6, 0.92, 0.22]} rotation={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.28, 0.06, 0.38]} />
        <meshStandardMaterial color="#047857" />
      </mesh>
      {/* The top book's cover and the page under it, both hinged on the same spine at the pile's
          -X edge. `page` is a `wobble`, scaled by the same open signal — so it riffles while the
          book is open and is perfectly still while it is shut. */}
      <group position={[-0.74, 0.951, 0.22]} rotation={[0, 0.1, 0]}>
        <group ref={anim.ref('bookCover')}>
          <mesh position={[0.14, 0.006, 0]} castShadow>
            <boxGeometry args={[0.28, 0.012, 0.38]} />
            <meshStandardMaterial color="#065f46" roughness={0.75} />
          </mesh>
        </group>
        <group ref={anim.ref('page')}>
          <mesh position={[0.13, -0.004, 0]}>
            <boxGeometry args={[0.26, 0.006, 0.35]} />
            <meshStandardMaterial color="#f4ecd8" roughness={0.95} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/**
 * 人體工學網椅 —— the gas lift sinks under a sitter, and then the seat drifts on its castors.
 *
 * `swivel` wraps the seat and the backrest but NOT the base or the legs, which is the difference
 * between an office chair turning and an office chair being dragged across the room.
 */
function ErgonomicChairModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale * 0.95}>
      <group ref={anim.ref('swivel')}>
      <group ref={anim.ref('seat')}>
      {/* Cushion seat */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.55, 0.08, 0.55]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      {/* Backrest mesh */}
      <mesh position={[0, 0.9, -0.24]} rotation={[0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.5, 0.8, 0.06]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
      </group>
      </group>
      {/* Center Support Pole */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.4, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Base Star Legs */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={i}
          position={[Math.cos(i * Math.PI * 2 / 5) * 0.25, 0.02, Math.sin(i * Math.PI * 2 / 5) * 0.25]}
          rotation={[0, -i * Math.PI * 2 / 5, -0.1]}
          castShadow
        >
          <boxGeometry args={[0.25, 0.04, 0.06]} />
          <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** 五星級雙人床 —— the mattress takes the weight over the same 0.9 s the body takes to lie down. */
function DoubleBedModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Wood bed frame */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.3, 2.2]} />
        <meshStandardMaterial color="#78350f" roughness={0.7} />
      </mesh>
      {/* Bed headboard */}
      <mesh position={[0, 0.7, -1.05]} castShadow>
        <boxGeometry args={[2.2, 0.8, 0.1]} />
        <meshStandardMaterial color="#451a03" roughness={0.6} />
      </mesh>
      {/* Mattress white sheet. Group at its underside so it compresses onto the frame. */}
      <group position={[0, 0.275, 0.05]} ref={anim.ref('mattress')}>
        <mesh position={[0, 0.175, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.1, 0.35, 2.0]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </mesh>
      </group>
      {/* Pillows */}
      <mesh position={[-0.55, 0.65, -0.75]} rotation={[-0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.12, 0.45]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.5} />
      </mesh>
      <mesh position={[0.55, 0.65, -0.75]} rotation={[-0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.12, 0.45]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.5} />
      </mesh>
      {/* Warm blanket cozy stripe. Drapes 2cm past the foot of the mattress
          (z=1.07 vs 1.05) instead of ending exactly flush with it — flush put
          the indigo blanket and the white sheet on one shared plane, both
          facing the viewer, which z-fights into speckle at the foot of the bed. */}
      <mesh position={[0, 0.47, 0.51]} castShadow>
        <boxGeometry args={[2.12, 0.33, 1.12]} />
        <meshStandardMaterial color="#6366f1" roughness={0.5} />
      </mesh>
    </group>
  );
}

/**
 * 實木大衣櫃 —— THE PIECE THE OBJECT-ANIMATION BRIEF LEADS WITH.
 *
 * The doors were two meshes parented straight to the carcass, so 「櫃門打開」 had nowhere to
 * happen: turning either one about its own centre would have swung it through the middle of the
 * wardrobe, and turning the root would have spun the whole thing on the floor.
 *
 * Each leaf is now a `<group>` AT ITS HINGE STILE — the outer edge, x = ±0.71 — with the leaf and
 * its pull bar sitting inside it at the offsets that put them back exactly where they were. The
 * carcass is outside both groups. That is the whole of 「不應整個衣櫃一起旋轉」 and
 * 「櫃門應從正確的 Pivot Point 旋轉」: it is structural, not a number anyone has to keep right.
 *
 * How far and how fast they swing, and the fact that they STAY open until the next interaction,
 * are constants/objectAnimations.ts's `wardrobe` row. Nothing about it is here.
 */
function WardrobeModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Wood carcass */}
      <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 2.5, 0.75]} />
        <meshStandardMaterial color="#78350f" roughness={0.6} />
      </mesh>
      {/* The inside, drawn ONLY while the doors are open. A wardrobe you can open onto a solid
          brown slab is worse than one that does not open at all, and mounting it by state means
          the closed piece pays nothing for it — no meshes, and nothing for the collider audit to
          measure (the harness never runs the state, so it always measures the shut wardrobe). */}
      {anim.active && (
        <group position={[0, 1.25, 0.377]}>
          <mesh>
            <boxGeometry args={[1.42, 2.4, 0.01]} />
            <meshStandardMaterial color="#43220a" roughness={0.95} />
          </mesh>
          {/* Hanging rail. */}
          <mesh position={[0, 0.78, 0.012]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.018, 1.36, 6]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Five garments on it, in the island palette. */}
          {[-0.52, -0.26, 0, 0.26, 0.52].map((x, i) => (
            <group key={`garment-${i}`} position={[x, 0.4, 0.02]}>
              <mesh position={[0, 0.34, 0]} castShadow>
                <boxGeometry args={[0.16, 0.06, 0.02]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
              </mesh>
              <mesh castShadow>
                <boxGeometry args={[0.2, 0.62, 0.05]} />
                <meshStandardMaterial
                  color={['#3f6f6a', '#c9836f', '#e8c37a', '#8fa9a2', '#9c7fb8'][i]}
                  roughness={0.95}
                />
              </mesh>
            </group>
          ))}
          {/* A folded stack on the bottom shelf. */}
          <mesh position={[-0.36, -0.92, 0.05]} castShadow>
            <boxGeometry args={[0.52, 0.02, 0.06]} />
            <meshStandardMaterial color="#f2e8d8" roughness={0.95} />
          </mesh>
          <mesh position={[-0.36, -0.86, 0.05]} castShadow>
            <boxGeometry args={[0.5, 0.02, 0.06]} />
            <meshStandardMaterial color="#cfe3e0" roughness={0.95} />
          </mesh>
        </group>
      )}
      {/* Left leaf, hinged on the carcass's -X stile. */}
      <group position={[-0.71, 1.25, 0.38]} ref={anim.ref('doorLeft')}>
        <mesh position={[0.35, 0, 0]} castShadow>
          <boxGeometry args={[0.7, 2.4, 0.03]} />
          <meshStandardMaterial color="#b45309" roughness={0.5} />
        </mesh>
        <mesh position={[0.66, -0.05, 0.03]} castShadow>
          <boxGeometry args={[0.02, 0.4, 0.02]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
      {/* Right leaf, mirrored onto the +X stile. */}
      <group position={[0.71, 1.25, 0.38]} ref={anim.ref('doorRight')}>
        <mesh position={[-0.35, 0, 0]} castShadow>
          <boxGeometry args={[0.7, 2.4, 0.03]} />
          <meshStandardMaterial color="#b45309" roughness={0.5} />
        </mesh>
        <mesh position={[-0.66, -0.05, 0.03]} castShadow>
          <boxGeometry args={[0.02, 0.4, 0.02]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

function NightstandModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.7, 0.65]} />
        <meshStandardMaterial color="#b45309" roughness={0.5} />
      </mesh>
      {/* drawer fronts */}
      <mesh position={[0, 0.5, 0.33]} castShadow>
        <boxGeometry args={[0.62, 0.22, 0.02]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>
      <mesh position={[0, 0.2, 0.33]} castShadow>
        <boxGeometry args={[0.62, 0.22, 0.02]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>
      {/* little gold knobs */}
      <mesh position={[0, 0.5, 0.35]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0.2, 0.35]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

function StorageCrateModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Wood crate body */}
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.75, 0.7, 0.75]} />
        <meshStandardMaterial color="#d97706" roughness={0.8} />
      </mesh>
      {/* Cross braces diagonals */}
      {[-0.38, 0.38].map((z, idx) => (
        <group key={idx} position={[0, 0.35, z]}>
          {/* outer panels outlines */}
          <mesh castShadow>
            <boxGeometry args={[0.7, 0.06, 0.02]} />
            <meshStandardMaterial color="#b45309" />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 4]} castShadow>
            <boxGeometry args={[0.85, 0.04, 0.02]} />
            <meshStandardMaterial color="#92400e" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function IndustrialRackModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* 4 Metal corner posts */}
      {[-0.55, 0.55].map((x) => [-0.25, 0.25].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.9, z]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 1.8, 8]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
        </mesh>
      )))}
      {/* 3 Shelves boards */}
      {[0.1, 0.8, 1.5].map((y, idx) => (
        <group key={idx} position={[0, y, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.2, 0.04, 0.6]} />
            <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.4} />
          </mesh>
          {/* Some voxel crates/goods on the shelf floors */}
          {idx === 1 && (
            <mesh position={[0.2, 0.15, 0]} castShadow>
              <boxGeometry args={[0.3, 0.25, 0.4]} />
              <meshStandardMaterial color="#1e40af" />
            </mesh>
          )}
          {idx === 0 && (
            <mesh position={[-0.3, 0.15, 0.1]} castShadow>
              <boxGeometry args={[0.4, 0.2, 0.3]} />
              <meshStandardMaterial color="#b45309" />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * NO TWO PARTS OF THIS SOFA MAY SHARE A FACE PLANE.
 *
 * The seat, back and arms interpenetrate — which is fine and normal — but they
 * were all authored to the same 2.2 width and 1.0 depth, so the seat's outer
 * faces at x=+/-1.1, the back's at x=+/-1.1 and the arms' at x=+/-1.1 all landed
 * on exactly the same plane, as did the arms' and seat's front/back faces at
 * z=+/-0.5. Ten coincident face pairs in total, between three different blues
 * (#3b82f6 / #2563eb / #1d4ed8).
 *
 * Two coplanar front-facing surfaces give the depth buffer nothing to order
 * them by, so the renderer picks per pixel and the choice flips as the camera
 * moves: light blue, dark blue, light blue. That is the grey/black speckle
 * reported on the sofa — it is geometry, not lighting, which is why widening
 * the shadow camera and adding shadow bias did not touch it.
 *
 * The offsets below are cosmetic (arms a couple of centimetres proud of the
 * base and slightly shallower, back very slightly narrower — all of which is
 * how a real sofa is built anyway) and exist only to keep every face on its own
 * plane. `npm run audit:placements` fails if any pair goes coincident again.
 */
/**
 * 奢華沙發. Three layers rather than four flat boxes: frame, then separate seat and back
 * CUSHIONS set inboard of it, then the small stuff (piping, feet).
 *
 * The seat top stays at y=0.70 to the millimetre, because `item-21`'s `sit` anchor is
 * `surfaceY: 0.805` and `npm run audit:interactions` measures the pose against the model that
 * actually ships. Detail is added by dividing the volume that is already there — never by
 * raising the surface the player sits on.
 */
/** 奢華沙發 —— the cushions give as the hips come down. See the `occupied` block in the catalog. */
function LuxurySofaModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Plinth — the frame the cushions drop into. Slightly narrower than the seat above so
          the sofa reads as upholstery sitting ON a base rather than one solid block. */}
      <mesh position={[0, 0.19, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.34, 0.94]} />
        <meshStandardMaterial color="#1e3a8a" roughness={0.6} />
      </mesh>
      {/* Seat deck. Top face y=0.70. */}
      <mesh position={[0, 0.53, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.34, 1.0]} />
        <meshStandardMaterial color="#3b82f6" roughness={0.45} />
      </mesh>
      {/* Two seat cushions, inset and split down the middle. The 1cm lift above the deck is
          what makes the seam read; flush would be one plane and would speckle. */}
      {[-0.52, 0.52].map((x, i) => (
        // The group sits at the cushion's BOTTOM face, so compressing it scales downward instead
        // of shrinking about its middle and lifting off the deck. See ObjectMotion's `scale`.
        <group key={`cush-${x}`} position={[x, 0.68, 0.03]} ref={anim.ref('cushion', i)}>
          <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.98, 0.06, 0.84]} />
            <meshStandardMaterial color="#60a5fa" roughness={0.55} />
          </mesh>
        </group>
      ))}
      {/* Backrest frame. */}
      <mesh position={[0, 0.85, -0.4]} castShadow receiveShadow>
        <boxGeometry args={[2.16, 0.7, 0.25]} />
        <meshStandardMaterial color="#2563eb" roughness={0.5} />
      </mesh>
      {/* Two back cushions, proud of the frame by 3cm and slightly rounded off by being
          narrower than the bay they sit in. */}
      {[-0.5, 0.5].map((x) => (
        <mesh key={`back-${x}`} position={[x, 0.87, -0.26]} castShadow>
          <boxGeometry args={[0.92, 0.56, 0.16]} />
          <meshStandardMaterial color="#60a5fa" roughness={0.55} />
        </mesh>
      ))}
      {/* Arms: proud of the seat (x=1.14 vs 1.10) and shallower (z=0.48 vs 0.50), so no face
          of theirs is coplanar with the seat's or the backrest's. */}
      {[-1.02, 1.02].map((x) => (
        <group key={`arm-${x}`}>
          <mesh position={[x, 0.6, 0]} castShadow>
            <boxGeometry args={[0.24, 0.5, 0.96]} />
            <meshStandardMaterial color="#1d4ed8" roughness={0.5} />
          </mesh>
          {/* Rolled top — a half-round capping the arm, the one curve on the piece. */}
          <mesh position={[x, 0.85, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.92, 10]} />
            <meshStandardMaterial color="#1d4ed8" roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* Brass feet. Small, but they are what stops the sofa reading as a block on the floor. */}
      {[-0.9, 0.9].map((x) => [-0.36, 0.36].map((z) => (
        <mesh key={`foot-${x}-${z}`} position={[x, 0.05, z]} castShadow>
          <cylinderGeometry args={[0.05, 0.04, 0.1, 8]} />
          <meshStandardMaterial color="#c8a24a" roughness={0.4} metalness={0.5} />
        </mesh>
      )))}
    </group>
  );
}

/**
 * 熱帶木桌 — a low island coffee table: a thick slab on chunky splayed legs with a rattan
 * under-shelf. Deliberately NOT the same silhouette as 橡木書桌 (DeskModel), which is taller,
 * rectangular and has a drawer bank; the two used to share one shop icon and that is fixed too.
 */
function TropicalTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Slab top with a lighter inlay panel, so the surface has two woods rather than one. */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.1, 1.5]} />
        <meshStandardMaterial color="#8a4b16" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.605, 0]} receiveShadow>
        <boxGeometry args={[1.22, 0.02, 1.22]} />
        <meshStandardMaterial color="#b9793a" roughness={0.7} />
      </mesh>
      {/* Apron rails under the top — the structure that says "joined", not "floating slab". */}
      {[-0.66, 0.66].map((z) => (
        <mesh key={`rail-z-${z}`} position={[0, 0.44, z]} castShadow>
          <boxGeometry args={[1.3, 0.09, 0.06]} />
          <meshStandardMaterial color="#6b3a12" roughness={0.8} />
        </mesh>
      ))}
      {[-0.66, 0.66].map((x) => (
        <mesh key={`rail-x-${x}`} position={[x, 0.44, 0]} castShadow>
          <boxGeometry args={[0.06, 0.085, 1.3]} />
          <meshStandardMaterial color="#6b3a12" roughness={0.8} />
        </mesh>
      ))}
      {/* Tapered legs — wider at the top, so they read as turned rather than as dowels. */}
      {[-0.65, 0.65].map((x) => [-0.65, 0.65].map((z) => (
        <mesh key={`leg-${x}-${z}`} position={[x, 0.25, z]} castShadow>
          <cylinderGeometry args={[0.09, 0.06, 0.5, 8]} />
          <meshStandardMaterial color="#5b3110" roughness={0.85} />
        </mesh>
      )))}
      {/* Woven under-shelf, with three slats reading as the weave. */}
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <boxGeometry args={[1.16, 0.03, 1.16]} />
        <meshStandardMaterial color="#c9a468" roughness={0.95} />
      </mesh>
      {[-0.36, 0, 0.36].map((z) => (
        <mesh key={`weave-${z}`} position={[0, 0.185, z]}>
          <boxGeometry args={[1.1, 0.015, 0.07]} />
          <meshStandardMaterial color="#b18d55" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A rug is a flat plane lying on another flat plane, which is the one case a
 * depth buffer cannot resolve by precision alone — the room floor is drawn at
 * y=-0.01 and a rug at y=0, a 1cm gap that is finer than the depth resolution
 * available at the distances build mode's camera pulls back to, so the two
 * used to flicker against each other.
 *
 * `polygonOffset` is the fix that actually holds: it biases the rug's depth
 * values toward the camera at rasterization time, so the rug wins against
 * whatever it lies on regardless of how coarse the depth buffer is out there.
 * The small `LAYER_Y_OFFSET.rug` lift applied in `FurnitureItem` handles the
 * shadow/lighting side; this handles the depth side. Two rugs overlapping each
 * other would be exactly coplanar and beyond even this — that case is refused
 * at placement time instead (lib/furniturePlacement.ts's `rug` layer).
 *
 * This is the project-wide decal preset, not a rug-specific one: the island's
 * stepping stones, footstep rings and placement indicators all lie on a surface
 * the same way and all use it. See constants/terrain.ts.
 */
const RUG_DEPTH_BIAS = DECAL_DEPTH_BIAS;

function WovenRugModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Rug border */}
      <mesh receiveShadow>
        <planeGeometry args={[4.2, 2.8]} />
        <meshStandardMaterial color="#ebd5b8" roughness={0.95} {...RUG_DEPTH_BIAS} />
      </mesh>
      {/* Inner rug fabric */}
      <mesh position={[0, 0, 0.002]} receiveShadow>
        <planeGeometry args={[3.9, 2.5]} />
        <meshStandardMaterial color="#fcf9f2" roughness={0.85} {...RUG_DEPTH_BIAS} polygonOffsetUnits={-6} />
      </mesh>
    </group>
  );
}

/**
 * 波西米亞編織地毯 — its OWN model.
 *
 * It used to share `WovenRugModel` with 編織地毯 and share that item's shop icon too, so the
 * catalog sold the same rug twice under two names at two prices. What separates them is what
 * separates the real things: this one is a warm terracotta kilim with a diamond running down the
 * middle and knotted fringes on the short ends; the other is a pale two-tone mat with a plain
 * border.
 */
function BohoRugModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Ground cloth. */}
      <mesh receiveShadow>
        <planeGeometry args={[3.6, 2.4]} />
        <meshStandardMaterial color="#b8543c" roughness={0.95} {...RUG_DEPTH_BIAS} />
      </mesh>
      {/* Cream field inside a terracotta border. */}
      <mesh position={[0, 0, 0.002]} receiveShadow>
        <planeGeometry args={[3.2, 2.0]} />
        <meshStandardMaterial color="#f0dcc0" roughness={0.9} {...RUG_DEPTH_BIAS} polygonOffsetUnits={-6} />
      </mesh>
      {/* Central diamond — one rotated square, the cheapest possible kilim motif. */}
      <mesh position={[0, 0, 0.004]} rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.95, 0.95]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.9} {...RUG_DEPTH_BIAS} polygonOffsetUnits={-10} />
      </mesh>
      <mesh position={[0, 0, 0.006]} rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.5, 0.5]} />
        <meshStandardMaterial color="#e0a24a" roughness={0.9} {...RUG_DEPTH_BIAS} polygonOffsetUnits={-14} />
      </mesh>
      {/* Two flanking chevrons, so the pattern is a band and not one lonely lozenge. */}
      {[-1.15, 1.15].map((x) => (
        <mesh key={`dia-${x}`} position={[x, 0, 0.004]} rotation={[0, 0, Math.PI / 4]}>
          <planeGeometry args={[0.52, 0.52]} />
          <meshStandardMaterial color="#3f6f6a" roughness={0.9} {...RUG_DEPTH_BIAS} polygonOffsetUnits={-10} />
        </mesh>
      ))}
      {/* Knotted fringes on the short ends. Nine tufts a side, flat like the rug itself. */}
      {[-1, 1].map((side) =>
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <mesh key={`fringe-${side}-${i}`} position={[side * 1.92, (i - 4) * 0.25, 0.001]}>
            <planeGeometry args={[0.24, 0.05]} />
            <meshStandardMaterial color="#e8d5b7" roughness={1} {...RUG_DEPTH_BIAS} />
          </mesh>
        ))
      )}
    </group>
  );
}

/**
 * 海風書架 — an open three-shelf bookcase, not a solid slab with two coloured blocks stuck on.
 *
 * The old model was a 1.2x2.4x0.4 box plus two boxes; its shop icon has always shown a proper
 * carcass with shelves, spines and a leaning book. This is that icon in 3D: side panels and a
 * back with three real shelves between them, then books standing in the gaps.
 */
/** 海風書架 —— 閱讀: one book eased off the middle shelf, tipped open, and put back. */
function BookshelfModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const SHELF_Y = [0.42, 1.14, 1.86];
  const BOOKS: { shelf: number; x: number; h: number; w: number; color: string }[] = [
    { shelf: 0, x: -0.42, h: 0.5, w: 0.11, color: '#2563eb' },
    { shelf: 0, x: -0.28, h: 0.44, w: 0.09, color: '#dc2626' },
    { shelf: 0, x: -0.15, h: 0.52, w: 0.12, color: '#f59e0b' },
    { shelf: 0, x: 0.0, h: 0.46, w: 0.1, color: '#0f766e' },
    { shelf: 1, x: -0.4, h: 0.48, w: 0.1, color: '#16a34a' },
    { shelf: 1, x: -0.26, h: 0.54, w: 0.12, color: '#7c3aed' },
    { shelf: 1, x: 0.37, h: 0.5, w: 0.11, color: '#0284c7' },
    { shelf: 2, x: -0.38, h: 0.42, w: 0.1, color: '#be185d' },
    { shelf: 2, x: -0.25, h: 0.5, w: 0.12, color: '#4d7c0f' },
  ];
  return (
    <group ref={anim.root} scale={scale}>
      {/* The one book the reader takes out. Chest height on purpose — it is where the `read`
          posture's hands are. */}
      <group position={[0.24, 1.27, 0.03]} ref={anim.ref('book')}>
        <group ref={anim.ref('bookTilt')}>
          <mesh castShadow>
            <boxGeometry args={[0.09, 0.44, 0.24]} />
            <meshStandardMaterial color="#ea580c" roughness={0.8} />
          </mesh>
        </group>
      </group>
      {/* Side panels. */}
      {[-0.57, 0.57].map((x) => (
        <mesh key={`side-${x}`} position={[x, 1.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.06, 2.4, 0.4]} />
          <meshStandardMaterial color="#a4652f" roughness={0.8} />
        </mesh>
      ))}
      {/* Back panel, recessed so the sides stand proud of it. */}
      <mesh position={[0, 1.2, -0.17]} receiveShadow>
        <boxGeometry args={[1.08, 2.36, 0.04]} />
        <meshStandardMaterial color="#7c4a20" roughness={0.9} />
      </mesh>
      {/* Top, bottom and three shelves. */}
      {[0.06, 2.37, ...SHELF_Y.map((y) => y + 0.3)].map((y, i) => (
        <mesh key={`shelf-${i}`} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.14, 0.05, 0.37]} />
          <meshStandardMaterial color="#b8763b" roughness={0.75} />
        </mesh>
      ))}
      {/* Books, standing on the shelf below each gap. */}
      {BOOKS.map((b, i) => (
        <mesh key={`book-${i}`} position={[b.x, SHELF_Y[b.shelf] + b.h / 2 - 0.09, 0.03]} castShadow>
          <boxGeometry args={[b.w, b.h, 0.24]} />
          <meshStandardMaterial color={b.color} roughness={0.8} />
        </mesh>
      ))}
      {/* One book left leaning, and a shell on the top shelf. Small evidence of a life. */}
      <mesh position={[0.13, SHELF_Y[1] + 0.14, 0.03]} rotation={[0, 0, 0.42]} castShadow>
        <boxGeometry args={[0.1, 0.46, 0.24]} />
        <meshStandardMaterial color="#f472b6" roughness={0.8} />
      </mesh>
      <mesh position={[0.28, SHELF_Y[2] + 0.02, 0.04]} rotation={[0.2, 0.5, 0]} castShadow>
        <coneGeometry args={[0.11, 0.2, 7]} />
        <meshStandardMaterial color="#f5e3c4" roughness={0.6} />
      </mesh>
      {/* Plinth, lifting the carcass off the floor. */}
      <mesh position={[0, 0.02, 0.02]} castShadow>
        <boxGeometry args={[1.06, 0.04, 0.34]} />
        <meshStandardMaterial color="#7c4a20" roughness={0.85} />
      </mesh>
    </group>
  );
}

function TorchModel({ scale, item }: FurnitureModelProps) {
  const torchScale = item?.id === 'item-20' ? scale * 1.8 : scale * 1.2;
  return (
    <group scale={torchScale}>
      <Torch item={item} />
    </group>
  );
}

function WallSconceModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale} position={[0, 1.0, 0]}>
      {/* Mounting backplate */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.04, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      {/* Horizontal rod metal stem */}
      <mesh position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.3, 12]} />
        <meshStandardMaterial color="#475569" roughness={0.6} />
      </mesh>
      {/* Vertical stem holding the shade */}
      <mesh position={[0, -0.1, 0.28]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.2, 12]} />
        <meshStandardMaterial color="#475569" roughness={0.6} />
      </mesh>
      {/* Cone lamp shade */}
      <mesh position={[0, -0.22, 0.28]} castShadow>
        <cylinderGeometry args={[0.08, 0.22, 0.18, 16, 1, true]} />
        <meshStandardMaterial color="#fdfefd" roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* Glowing bulb and the light it throws, through the shared fixture seam. This one is
          `always` — the room's night light, and the only mains fixture deliberately held off the
          switch. See `LightBehaviour` in constants/lighting.ts for why that is a product decision
          rather than a claim about batteries. */}
      <FixtureLight item={item} position={[0, -0.32, 0.28]}>
        <mesh position={[0, -0.26, 0.28]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color="#fef08a" emissive="#fef08a" emissiveIntensity={1.5} />
        </mesh>
      </FixtureLight>
    </group>
  );
}

/* ================================================================ 燈具 — the eight-way collapse
 *
 * Everything from here to `TorchModel` used to be ONE component, `DecorLampModel`: a 0.8 grey
 * cube with a glowing sphere on top. It was reached by `n.includes('裝飾台') || n.includes('燈')`,
 * which is every one of these products' names, so the shop's eight different pictures all bought
 * the same object. Each now models what its own icon promises. See constants/furnitureModels.ts.
 */

/**
 * 貝殼裝飾台 — a pedestal with a glass cloche over a golden shell, matching its icon exactly.
 * Not a lamp at all, which is why sharing a lamp model was the most visible of the eight.
 *
 * `tabletop: true`, so the top of the cloche is what other things get placed on.
 */
function ShellDisplayStandModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Base plinth in two steps. */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.92, 0.1, 0.72]} />
        <meshStandardMaterial color="#4c5c63" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.29, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.82, 0.38, 0.64]} />
        <meshStandardMaterial color="#64748b" roughness={0.55} />
      </mesh>
      {/* Drawer line + pull, so the pedestal reads as a cabinet rather than a block. */}
      <mesh position={[0, 0.3, 0.325]}>
        <boxGeometry args={[0.7, 0.02, 0.01]} />
        <meshStandardMaterial color="#3d4b52" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.42, 0.34]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.03, 10]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Display deck the cloche stands on. */}
      <mesh position={[0, 0.51, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.06, 0.68]} />
        <meshStandardMaterial color="#8a9aa2" roughness={0.5} />
      </mesh>
      {/* The shell itself — a fluted cone, the piece the whole thing exists for. */}
      <mesh position={[0, 0.66, 0]} rotation={[0.25, 0, 0]} castShadow>
        <coneGeometry args={[0.17, 0.3, 7]} />
        <meshStandardMaterial color="#f0b429" roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.55, 0.02]} castShadow>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color="#f6d27a" roughness={0.4} />
      </mesh>
      {/* Glass cloche. Open-ended cylinder + hemisphere cap, drawn double-sided so it reads as
          glass from inside as well as out. */}
      <mesh position={[0, 0.76, 0]} castShadow>
        <cylinderGeometry args={[0.29, 0.29, 0.44, 18, 1, true]} />
        <meshStandardMaterial color="#dbeefb" transparent opacity={0.34} roughness={0.05} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <sphereGeometry args={[0.29, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#dbeefb" transparent opacity={0.34} roughness={0.05} side={THREE.DoubleSide} />
      </mesh>
      {/* Brass finial. */}
      <mesh position={[0, 1.03, 0]} castShadow>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.6} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** 復古提燈 — a brass carry lantern: ring handle, glazed box, a flame inside. */
function VintageLanternModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Foot and base. */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.19, 0.22, 0.08, 8]} />
        <meshStandardMaterial color="#7a5a2e" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Four corner posts framing the glass. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`post-${sx}-${sz}`} position={[sx * 0.13, 0.31, sz * 0.13]} castShadow>
          <boxGeometry args={[0.035, 0.46, 0.035]} />
          <meshStandardMaterial color="#8b6a35" roughness={0.45} metalness={0.45} />
        </mesh>
      )))}
      {/* Glass box between them. */}
      <mesh position={[0, 0.31, 0]}>
        <boxGeometry args={[0.24, 0.44, 0.24]} />
        <meshStandardMaterial color="#fde9b8" transparent opacity={0.3} roughness={0.1} />
      </mesh>
      {/* Candle and flame. */}
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.14, 8]} />
        <meshStandardMaterial color="#fdf6e3" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.29, 0]}>
        <coneGeometry args={[0.05, 0.13, 8]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.6} />
      </mesh>
      {/* Cap, sloped, with a vent disc. */}
      <mesh position={[0, 0.58, 0]} castShadow>
        <coneGeometry args={[0.24, 0.14, 4]} />
        <meshStandardMaterial color="#7a5a2e" roughness={0.5} metalness={0.45} />
      </mesh>
      <mesh position={[0, 0.66, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.03, 8]} />
        <meshStandardMaterial color="#8b6a35" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Ring handle. */}
      <mesh position={[0, 0.75, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.09, 0.018, 6, 14]} />
        <meshStandardMaterial color="#8b6a35" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* An oil lamp: its own fuel, so 'always' — the wall switch has no wire to it. */}
      <FixtureLight item={item} position={[0, 0.3, 0]} />
    </group>
  );
}

/** 石製路燈 — a stacked-stone post with a four-pane lantern head and a small hanging sign. */
function StoneStreetLampModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Stepped stone footing — three courses, each slightly rotated, so it reads as stacked. */}
      {[
        { y: 0.06, r: 0.32, h: 0.12, rot: 0 },
        { y: 0.19, r: 0.27, h: 0.14, rot: 0.4 },
        { y: 0.32, r: 0.23, h: 0.12, rot: 0.8 },
      ].map((c, i) => (
        <mesh key={`course-${i}`} position={[0, c.y, 0]} rotation={[0, c.rot, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[c.r, c.r + 0.02, c.h, 6]} />
          <meshStandardMaterial color={i % 2 ? '#8b8f8c' : '#9aa09c'} roughness={0.95} />
        </mesh>
      ))}
      {/* Post. */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.1, 1.3, 8]} />
        <meshStandardMaterial color="#7e837f" roughness={0.9} />
      </mesh>
      {/* Collar under the head. */}
      <mesh position={[0, 1.66, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.1, 0.08, 8]} />
        <meshStandardMaterial color="#6d726e" roughness={0.85} />
      </mesh>
      {/* Lantern head: four stone mullions around a warm glazed core. */}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={`mullion-${i}`}
          position={[Math.cos((i * Math.PI) / 2) * 0.15, 1.95, Math.sin((i * Math.PI) / 2) * 0.15]}
          rotation={[0, -(i * Math.PI) / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.045, 0.42, 0.045]} />
          <meshStandardMaterial color="#6d726e" roughness={0.85} />
        </mesh>
      ))}
      <FixtureLight item={item} position={[0, 1.95, 0]}>
        <mesh position={[0, 1.95, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.4, 8]} />
          <meshStandardMaterial color="#ffe6a8" emissive="#ffcf70" emissiveIntensity={1.1} transparent opacity={0.85} />
        </mesh>
      </FixtureLight>
      {/* Pyramid cap and finial. */}
      <mesh position={[0, 2.24, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.26, 0.2, 4]} />
        <meshStandardMaterial color="#5f6461" roughness={0.85} />
      </mesh>
      <mesh position={[0, 2.38, 0]} castShadow>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial color="#5f6461" roughness={0.8} />
      </mesh>
      {/* A little wooden sign on a bracket — the detail that makes it island rather than municipal. */}
      <mesh position={[0.18, 1.42, 0]} castShadow>
        <boxGeometry args={[0.22, 0.03, 0.03]} />
        <meshStandardMaterial color="#8a6a3f" roughness={0.9} />
      </mesh>
      <mesh position={[0.27, 1.29, 0]} rotation={[0, 0, 0.08]} castShadow>
        <boxGeometry args={[0.24, 0.16, 0.025]} />
        <meshStandardMaterial color="#c79a5e" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** 螢光石燈 — a driftwood cradle holding a cluster of glowing crystals. */
function GlowStoneLampModel({ scale, item }: FurnitureModelProps) {
  const SHARDS: { p: [number, number, number]; r: number; rot: [number, number, number] }[] = [
    { p: [0, 0.36, 0], r: 0.17, rot: [0.1, 0.4, 0.05] },
    { p: [-0.16, 0.26, 0.07], r: 0.11, rot: [0.3, 1.1, -0.2] },
    { p: [0.15, 0.28, -0.06], r: 0.12, rot: [-0.2, 0.7, 0.25] },
    { p: [0.03, 0.24, -0.16], r: 0.09, rot: [0.5, 0.2, 0.1] },
  ];
  return (
    <group scale={scale}>
      {/* Driftwood base — a flattened log with two stub roots. */}
      <mesh position={[0, 0.09, 0]} rotation={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.38, 0.18, 7]} />
        <meshStandardMaterial color="#9c8060" roughness={0.95} />
      </mesh>
      {[-0.3, 0.32].map((x, i) => (
        <mesh key={`root-${i}`} position={[x, 0.14, i ? 0.14 : -0.12]} rotation={[0, 0, i ? 0.4 : -0.4]} castShadow>
          <cylinderGeometry args={[0.05, 0.07, 0.24, 6]} />
          <meshStandardMaterial color="#8a7053" roughness={0.95} />
        </mesh>
      ))}
      {/* Moss collar where the crystals grow out of the wood. */}
      <mesh position={[0, 0.185, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.05, 8]} />
        <meshStandardMaterial color="#5b7f4a" roughness={1} />
      </mesh>
      {/* The crystals. Octahedra, which is the cheapest shape that reads as "faceted". */}
      {SHARDS.map((s, i) => (
        <mesh key={`shard-${i}`} position={s.p} rotation={s.rot} castShadow>
          <octahedronGeometry args={[s.r, 0]} />
          <meshStandardMaterial
            color="#a8f0e6"
            emissive="#4fd8c6"
            emissiveIntensity={1.3}
            transparent
            opacity={0.88}
            roughness={0.15}
          />
        </mesh>
      ))}
      {/* Phosphorescent: 'always', so it is still glowing after the wall switch goes off — which
          is when the product's own description (「無需能源也能恆久發光」) is finally visible. */}
      <FixtureLight item={item} position={[0, 0.4, 0]} />
    </group>
  );
}

/** 水晶吊燈 — a ceiling piece: three tiers of hanging drops on a brass frame. */
function CrystalChandelierModel({ scale, item }: FurnitureModelProps) {
  const tier = (radius: number, y: number, count: number, dropLen: number, key: string) => (
    <group key={key} position={[0, y, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[radius, 0.022, 6, 20]} />
        <meshStandardMaterial color="#d4b06a" metalness={0.65} roughness={0.3} />
      </mesh>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, -dropLen / 2 - 0.03, Math.sin(a) * radius]} castShadow>
            <octahedronGeometry args={[dropLen * 0.42, 0]} />
            <meshStandardMaterial
              color="#eaf6ff"
              emissive="#cfe8ff"
              emissiveIntensity={0.55}
              transparent
              opacity={0.75}
              roughness={0.05}
              metalness={0.1}
            />
          </mesh>
        );
      })}
    </group>
  );
  return (
    <group scale={scale}>
      {/* Ceiling rose and chain. */}
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.16, 0.05, 12]} />
        <meshStandardMaterial color="#d4b06a" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.2, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.42, 6]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.65} roughness={0.35} />
      </mesh>
      {/* Central column. */}
      <mesh position={[0, -0.62, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.44, 10]} />
        <meshStandardMaterial color="#d4b06a" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* The lit core AND the three tiers of drops, widest at the top.

          The tiers are inside the fixture seam, not beside it, and that is the whole reason this
          component's children are a group rather than a single bulb. A crystal drop is emissive,
          and emissive is unlit by definition — so with the tiers outside, flipping the wall switch
          put out the core and left twenty-four pale blue drops hanging in a dark room, glowing at
          their authored 0.55 with nothing in the scene able to dim them. That is precisely the
          「燈關了卻還在發光」 FixtureLight exists to make impossible.

          The brass rings come along for the ride and are unaffected: only EMISSIVE materials among
          the children follow the switch, which is what lets a model wrap whatever grouping is
          convenient instead of having to isolate its glowing faces. */}
      <FixtureLight item={item} position={[0, -0.9, 0]}>
        {tier(0.46, -0.46, 10, 0.2, 'tier-a')}
        {tier(0.33, -0.66, 8, 0.17, 'tier-b')}
        {tier(0.19, -0.84, 6, 0.14, 'tier-c')}
        <mesh position={[0, -0.86, 0]}>
          <sphereGeometry args={[0.11, 14, 12]} />
          <meshStandardMaterial color="#fff6dc" emissive="#ffe9b0" emissiveIntensity={1.7} />
        </mesh>
      </FixtureLight>
    </group>
  );
}

/** 工業風吊燈 — a black enamel dome on a braided flex, with a cage and an exposed bulb. */
function IndustrialPendantModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.13, 0.05, 10]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} metalness={0.3} />
      </mesh>
      {/* Flex. */}
      <mesh position={[0, -0.33, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.66, 6]} />
        <meshStandardMaterial color="#374151" roughness={0.85} />
      </mesh>
      {/* Enamel dome shade, open-ended so the inside shows its white lining. */}
      <mesh position={[0, -0.78, 0]} castShadow>
        <coneGeometry args={[0.42, 0.34, 16, 1, true]} />
        <meshStandardMaterial color="#111827" roughness={0.5} metalness={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.79, 0]}>
        <coneGeometry args={[0.39, 0.3, 16, 1, true]} />
        <meshStandardMaterial color="#f4f4f5" roughness={0.6} side={THREE.BackSide} />
      </mesh>
      {/* Shade collar. */}
      <mesh position={[0, -0.615, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.08, 10]} />
        <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Cage — four bowed ribs plus a hoop. */}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={`rib-${i}`}
          position={[Math.cos((i * Math.PI) / 2) * 0.15, -1.0, Math.sin((i * Math.PI) / 2) * 0.15]}
          castShadow
        >
          <boxGeometry args={[0.02, 0.3, 0.02]} />
          <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, -1.14, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.15, 0.016, 6, 14]} />
        <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Edison bulb. */}
      <FixtureLight item={item} position={[0, -1.05, 0]}>
        <mesh position={[0, -1.0, 0]}>
          <sphereGeometry args={[0.11, 12, 10]} />
          <meshStandardMaterial color="#ffd68a" emissive="#ffb347" emissiveIntensity={1.5} />
        </mesh>
      </FixtureLight>
    </group>
  );
}

/** 現代簡約吊燈 — three slim aluminium cylinders hanging at staggered heights from one plate. */
function ModernPendantModel({ scale, item }: FurnitureModelProps) {
  const DROPS: { x: number; len: number }[] = [
    { x: -0.34, len: 0.5 },
    { x: 0, len: 0.78 },
    { x: 0.34, len: 0.62 },
  ];
  return (
    <group scale={scale}>
      {/* One flat bar plate for all three. */}
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.92, 0.04, 0.12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* All three drops inside one FixtureLight: only their emissive diffuser discs follow the
          switch, so wrapping the tubes and rods along with them costs nothing. */}
      <FixtureLight item={item} position={[0, -0.95, 0]}>
        {DROPS.map((d, i) => (
          <group key={`drop-${i}`} position={[d.x, 0, 0]}>
            <mesh position={[0, -d.len / 2, 0]} castShadow>
              <cylinderGeometry args={[0.008, 0.008, d.len, 6]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.4} />
            </mesh>
            {/* Tube shade. */}
            <mesh position={[0, -d.len - 0.13, 0]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 0.26, 14, 1, true]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.25} roughness={0.5} side={THREE.DoubleSide} />
            </mesh>
            {/* Diffuser disc at the bottom of the tube. */}
            <mesh position={[0, -d.len - 0.255, 0]}>
              <cylinderGeometry args={[0.095, 0.095, 0.02, 14]} />
              <meshStandardMaterial color="#fffdf5" emissive="#fff8e2" emissiveIntensity={1.4} />
            </mesh>
          </group>
        ))}
      </FixtureLight>
    </group>
  );
}

/** 自然/木質吊燈 — a turned wooden bowl on a jute cord, with a rattan hoop under the rim. */
function WoodPendantModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.12, 0.05, 10]} />
        <meshStandardMaterial color="#8a6a3f" roughness={0.85} />
      </mesh>
      {/* Jute cord, thicker and rougher than the metal pendants' flex. */}
      <mesh position={[0, -0.3, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, 0.6, 6]} />
        <meshStandardMaterial color="#c8a97a" roughness={1} />
      </mesh>
      {/* Bowl shade — staves of two alternating woods, which is what makes it read as turned. */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh
            key={`stave-${i}`}
            position={[Math.cos(a) * 0.3, -0.74, Math.sin(a) * 0.3]}
            rotation={[0.32, -a, 0]}
            castShadow
          >
            <boxGeometry args={[0.17, 0.3, 0.035]} />
            <meshStandardMaterial color={i % 2 ? '#b98a52' : '#a3773f'} roughness={0.9} />
          </mesh>
        );
      })}
      {/* Rattan hoop under the rim. */}
      <mesh position={[0, -0.88, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.33, 0.022, 6, 18]} />
        <meshStandardMaterial color="#d9b57f" roughness={0.95} />
      </mesh>
      {/* Warm bulb, deep enough inside the bowl that it lights the staves. */}
      <FixtureLight item={item} position={[0, -0.84, 0]}>
        <mesh position={[0, -0.78, 0]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshStandardMaterial color="#ffeec2" emissive="#ffd693" emissiveIntensity={1.4} />
        </mesh>
      </FixtureLight>
    </group>
  );
}

/* ==========================================================================================
 *                              室外資產 —— OUTDOOR ASSETS
 *
 * 這一段以下的模型都是玩家放在島上的東西，它們遵守 docs/outdoor-assets.md 的
 * Outdoor Asset Quality Standard。三條規則，寫在這裡是因為它們是「編輯這些模型時」要記得的事：
 *
 *  1. **三層結構**：Primary Shape（遠看認得出是什麼）→ Secondary Structure（撐住它的東西：
 *     腳架、橫樑、邊框、基座）→ Small Details（釘子、繩結、封邊、小裝飾）。少了第二層的物件
 *     就是「基礎 Geometry」，那正是這次改版要修掉的東西。
 *  2. **色彩分層**：同一種材質至少兩階明暗（受光面淺、背光面／結構件深），而且取自下面這份
 *     共用色盤。不是為了寫實，是為了讓相鄰的面分得出來 —— 單色的木頭在 low poly 裡會糊成一塊。
 *  3. **Mesh 預算**：Large ≤ 24、Medium ≤ 20、Small ≤ 12 個 mesh 宣告。每個 mesh 是一個
 *     draw call，而島上可能同時站著幾十件擺設；預算是拿來花的，但花完就要停。
 *
 * 另外一條，是這個檔案特有的陷阱：**不要在這些模型裡加 `useFrame`**。
 * scripts/lib/measureFurnitureModel.ts 是靠「直接呼叫元件函式」來量碰撞體積的，元件一旦用了
 * hook 就會 throw，然後被歸到 brokenComponents 而**整件商品跳過不量**。木製鞦韆、營火、望遠鏡、
 * 鳥屋、許願井 今天就是這樣沒被量到的（見 `npm run audit:colliders` 結尾那行）。
 * 那五件已經是動態的了，沒辦法；剩下的靜態模型每一件都還在稽核網子裡，別把它們推出去。
 * ========================================================================================== */

/**
 * 椰子樹 —— 彎曲的環紋樹幹、六片分層的葉子，以及冠下的一串椰子。
 *
 * 改版前它是三個 mesh：一根直圓柱、六片一模一樣的膠囊、一顆球。商店圖裡畫的是彎曲的樹幹、
 * 樹幹上的環紋、還有兩顆掛著的椰子 —— 那三樣東西模型上一樣都沒有，這是 §七「圖片與模型不一致」
 * 最明顯的一件。
 *
 * ## 樹冠的大小是被島的大小決定的
 *
 * 第一版的葉子做到 1.23 全長，量出來的擺放外框是 3.68×3.38 —— 比房子還寬，而草地半徑只有 5.7，
 * 整座島放得下三棵。葉子收到 0.84 全長之後外框回到 2.4 左右。走路碰撞不受影響（那一格只有樹幹的
 * 0.57，樹冠在 walk band 之上），但**擺放**判定看的是分層外框，所以樹冠有多寬就等於「旁邊多遠
 * 不能放高的東西」。要改葉子長度，先想一下這件事，然後跑 `npm run audit:colliders` 看外框。
 *
 * 樹幹是四段各自傾斜的圓柱，是這個模型唯一「非顯而易見」的地方：一根彎的樹幹在 low poly 裡
 * 沒辦法用一個 primitive 表示，但四段各轉一點點接起來，遠看就是一條曲線，近看接縫處的直徑差
 * 正好讀成椰子樹的環紋。
 *
 * 那四段現在是**巢狀**的（見 {@link PALM_TRUNK}）：接點就是子 group 的原點，所以段與段之間
 * 不可能裂開。上一版靠「段高大於段距」的重疊來遮接縫，那在靜止的樹上是對的，但也代表任何一段
 * 一動就會露出縫 —— 而一棵會被風吹的樹，每一幀都在動。
 */
/**
 * 椰子樹的樹幹 —— 由下往上四段，每一段的傾角是**相對前一段**的。
 *
 * 改版前這是一張絕對座標表（每一段各自寫死自己的 x、y 與傾角），畫出來一樣，但風一吹就沒救：
 * 一棵樹要彎，第二段就得跟著第一段動，而絕對座標裡的第二段不知道第一段在哪裡。改成巢狀之後，
 * 每一段是上一段的子節點，傾角自然累加成一條弧線，而且**把任何一段轉一點，上面的整串都跟著走** ——
 * 這正是風吹樹幹該有的行為，也是「不要整棵樹像剛體一樣左右旋轉」的唯一做法。
 *
 * 四段的累積傾角是 -0.030 / -0.070 / -0.120 / -0.180 弧度，樹幹頂端落在 (0.185, 2.168)，
 * 跟改版前的 (0.196, 2.158) 差不到一公分 —— 外型沒動，能動的骨架是新的。
 */
/*
  每一段的 `tilt` 是**相對前一段**的，所以四段加起來就是樹幹從根到冠總共歪掉的角度。

  改版前是 -0.03 / -0.04 / -0.05 / -0.06，加總 0.18 弧度 ≈ 10 度 —— 幾乎是一根直的柱子。商店
  縮圖上的椰子樹是一根明顯彎向一側的樹幹，那條曲線就是椰子樹的簽名（它是全島唯一一棵不直的
  樹）。加總改成 0.44 弧度 ≈ 25 度，而且是**越往上彎得越多**，讀起來才是被海風吹彎的，不是
  從地上就斜著長的。
*/
const PALM_TRUNK = [
  { len: 0.50, tilt: -0.055, rBottom: 0.172, rTop: 0.150 },
  { len: 0.46, tilt: -0.095, rBottom: 0.150, rTop: 0.132 },
  { len: 0.46, tilt: -0.135, rBottom: 0.132, rTop: 0.113 },
  { len: 0.46, tilt: -0.155, rBottom: 0.113, rTop: 0.094 },
] as const;

/** 樹幹底端接進板根的高度。 */
const PALM_TRUNK_BASE_Y = 0.30;

/*
  葉子：[繞 y 的方位角, 下垂角, 葉身長度]。

  **兩層**，這是第二版才改對的地方。第一版是六片長度相同、下垂角在 -0.1 到 -0.6 之間隨便散開的
  葉子，畫出來像一串香蕉：因為真正的椰子樹不是「一圈角度不一的葉子」，而是**上面一圈短的幾乎
  水平、下面一圈長的垂下去**。分成兩層之後輪廓才對。
*/
const PALM_FRONDS: readonly (readonly [number, number, number])[] = [
  // 上層 —— 短、微微上揚，撐開樹冠的輪廓
  [0.00, 0.14, 0.48], [1.57, 0.06, 0.48], [3.14, 0.16, 0.48], [4.71, 0.02, 0.48],
  // 下層 —— 長、明顯垂下來（約 55°），插在上層的四個空隙裡。
  [0.78, -0.95, 0.74], [2.36, -1.10, 0.74], [3.93, -0.88, 0.74], [5.50, -1.02, 0.74],
];

/** 葉身膠囊的半徑，以及它被壓扁的比例 —— 葉脈要待在葉子裡面，就得知道葉子有多厚。 */
const FROND_R = 0.18;
const FROND_FLATTEN = 0.22;
/** 葉面（壓扁後）離中線多高。葉脈的高度全部是從這個數字推的。 */
const FROND_HALF_THICK = FROND_R * FROND_FLATTEN;

/**
 * 椰子樹的風力骨架 —— 一棵樹十三個節點，共用**一個** registry entry。
 *
 * `rest` 是這個節點沒有風的時候的角度，而且是這裡跟 JSX 唯一的一份：JSX 直接讀
 * `PALM_RIG.trunk0.rest`，所以「靜止姿勢」跟「風吹的基準」不可能對不上。少了這一步，稽核腳本
 * （它不會跑動畫）量到的會是一根筆直的樹幹，而遊戲裡第一幀也會先畫直的再跳成彎的。
 *
 * 梯度就是動畫本身：樹幹每段 0.016 弧度、樹冠 0.045、葉子 0.105，而且愈往外 `lag` 愈大 ——
 * 葉子讀的是樹幹 0.22 秒前讀過的那一陣風，所以它是「跟著晃」而不是「一起晃」。
 */
const PALM_RIG = {
  trunk0: { ...WIND_NODES.trunk, rest: [0, 0, PALM_TRUNK[0].tilt] as const },
  trunk1: { ...WIND_NODES.trunk, rest: [0, 0, PALM_TRUNK[1].tilt] as const, lag: 0.05 },
  trunk2: { ...WIND_NODES.trunk, rest: [0, 0, PALM_TRUNK[2].tilt] as const, lag: 0.10 },
  trunk3: { ...WIND_NODES.trunk, rest: [0, 0, PALM_TRUNK[3].tilt] as const, lag: 0.15 },
  crown: { ...WIND_NODES.branch, rest: [0, 0, 0] as const, lag: 0.18 },
  frond0: { ...WIND_NODES.frond, lag: 0.22 },
  frond1: { ...WIND_NODES.frond, lag: 0.25 },
  frond2: { ...WIND_NODES.frond, lag: 0.28 },
  frond3: { ...WIND_NODES.frond, lag: 0.31 },
  frond4: { ...WIND_NODES.frond, lag: 0.24, bend: 0.125 },
  frond5: { ...WIND_NODES.frond, lag: 0.27, bend: 0.125 },
  frond6: { ...WIND_NODES.frond, lag: 0.30, bend: 0.125 },
  frond7: { ...WIND_NODES.frond, lag: 0.33, bend: 0.125 },
  // 枯葉是死的，所以它最軟也最慢 —— 一片還掛在樹上的乾葉子確實是這樣動的。
  dead: { ...WIND_NODES.leaf, lag: 0.42 },
} as const;

type PalmRigKey = keyof typeof PALM_RIG;

function PalmTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<PalmRigKey>(rootRef, PALM_RIG, { seed: instanceId, radius: 3.2 });

  return (
    <group ref={rootRef} scale={scale * 1.2}>
      {/* 板根 —— 樹幹插進土裡那一段的外擴。少了它，樹幹就是一根插在草地上的柱子。
          它不隨風動：一棵樹的根不會動，會動的是根以上的部分。 */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.172, 0.30, 0.36, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>

      {/* 樹幹。四段巢狀，每一段的 group 就是它自己的彎折點。 */}
      <group ref={rig.ref('trunk0')} position={[0, PALM_TRUNK_BASE_Y, 0]} rotation={PALM_RIG.trunk0.rest}>
        <mesh position={[0, PALM_TRUNK[0].len / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[PALM_TRUNK[0].rTop, PALM_TRUNK[0].rBottom, PALM_TRUNK[0].len, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>

        <group ref={rig.ref('trunk1')} position={[0, PALM_TRUNK[0].len, 0]} rotation={PALM_RIG.trunk1.rest}>
          <mesh position={[0, PALM_TRUNK[1].len / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[PALM_TRUNK[1].rTop, PALM_TRUNK[1].rBottom, PALM_TRUNK[1].len, 8]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>

          <group ref={rig.ref('trunk2')} position={[0, PALM_TRUNK[1].len, 0]} rotation={PALM_RIG.trunk2.rest}>
            <mesh position={[0, PALM_TRUNK[2].len / 2, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[PALM_TRUNK[2].rTop, PALM_TRUNK[2].rBottom, PALM_TRUNK[2].len, 8]} />
              <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
            </mesh>

            <group ref={rig.ref('trunk3')} position={[0, PALM_TRUNK[2].len, 0]} rotation={PALM_RIG.trunk3.rest}>
              <mesh position={[0, PALM_TRUNK[3].len / 2, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[PALM_TRUNK[3].rTop, PALM_TRUNK[3].rBottom, PALM_TRUNK[3].len, 8]} />
                <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
              </mesh>

              {/* 樹冠。掛在樹幹最後一段的頂端，所以樹幹一彎它就跟著走。 */}
              <group ref={rig.ref('crown')} position={[0, PALM_TRUNK[3].len, 0]}>
                <mesh position={[0, 0.10, 0]} castShadow receiveShadow>
                  <sphereGeometry args={[0.165, 8, 7]} />
                  <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
                </mesh>

                {PALM_FRONDS.map(([a, droop, len], i) => {
                  // 膠囊的總長是 len + 2×半徑，所以葉子擺在自己一半長的地方、再往內縮 2 公分埋進樹冠球裡。
                  const total = len + FROND_R * 2;
                  // 葉脈提早 0.26 收尾，停在葉身還是滿厚度的那一段 —— 見下面的長註解。
                  const ribLen = total - 0.26;
                  return (
                    // 風的節點在**方位角外面**：這樣一陣風來的時候八片葉子是往同一個世界方向倒，
                    // 而不是各自繞著自己的軸拍動。每片葉子的 `lag` 不同，所以同一個方向、不同時間。
                    <group key={`frond-${i}`} ref={rig.ref(`frond${i}` as PalmRigKey)}>
                      <group rotation={[0, a, 0]}>
                        <group position={[0, 0.12, 0]} rotation={[0, 0, droop]}>
                          {/* 葉身。scale 壓的是 mesh 自己的 x —— 轉了 90° 之後那一軸才是世界的上下，
                              壓 z 的話壓到的是葉子的寬度，葉片就變成一根棍子。 */}
                          <mesh
                            position={[total / 2 - 0.02, 0, 0]}
                            rotation={[0, 0, Math.PI / 2]}
                            scale={[FROND_FLATTEN, 1, 1]}
                            castShadow
                          >
                            <capsuleGeometry args={[FROND_R, len, 3, 8]} />
                            <meshStandardMaterial color={i < 4 ? OUT_LEAF_LIGHT : OUT_LEAF} roughness={0.85} />
                          </mesh>
                          {/*
                            葉脈 —— 這是回報的「椰子樹破圖」真正的來源，而且是兩個問題疊在一起。

                            1. **方向反了。** 圓柱繞 Z 轉 90° 之後，`radiusTop`（第一個參數）那一端會
                               指向 -X，也就是**葉柄那一頭**。改版前寫的是 `args=[0.012, 0.030, …]`，
                               於是細的 0.012 在葉柄、粗的 0.030 在葉尖 —— 一片葉子的中肋是根粗尖細的，
                               這剛好反過來。
                            2. **粗的那一頭衝出葉子外面。** 葉尖是膠囊的半球帽，厚度往 0 收；在葉脈原本
                               結束的位置葉身的半厚只剩 0.025，而葉脈在那裡的半徑是 0.030。所以每一片葉子
                               的尖端都戳出一截深色的錐體，八片葉子就是八個。而且葉脈跟葉面在整條長度上
                               幾乎相切，相貫線又細又長，鏡頭一拉遠就沿著葉子閃。

                            現在葉脈的中心線抬到 FROND_HALF_THICK 之上一點點（0.0404 對 0.0396），
                            上下半徑 0.020 → 0.012：**它的下緣永遠在葉面底下、上緣永遠在葉面上面**，
                            所以兩個面是實實在在地穿過去而不是擦過去，而且提早 0.26 收尾，收在葉身還是
                            滿厚度的地方。從任何角度、任何距離看都是一條凸起的中肋。
                          */}
                          <mesh
                            position={[ribLen / 2, FROND_HALF_THICK + 0.0008, 0]}
                            rotation={[0, 0, Math.PI / 2]}
                            castShadow
                          >
                            <cylinderGeometry args={[0.020, 0.012, ribLen, 5]} />
                            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
                          </mesh>
                        </group>
                      </group>
                    </group>
                  );
                })}

                {/* 一片垂下來的枯葉。低 poly 的樹最容易看起來像塑膠模型，一片不同色、角度更陡的枯葉
                    就足以讓整棵樹讀成「長在那裡的東西」。

                    改版前它的兩端**都離樹冠球 0.44 以上** —— 一片浮在半空中、跟樹沒有接觸的葉子。
                    現在跟其他八片葉子用同一個做法：葉柄那一端縮 2 公分進樹冠球裡。 */}
                <group ref={rig.ref('dead')}>
                  <group rotation={[0, 2.6, 0]}>
                    <group position={[0, 0.06, 0]} rotation={[0, 0, -1.15]}>
                      <mesh position={[0.31, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.26, 1, 1]} castShadow>
                        <capsuleGeometry args={[0.13, 0.40, 3, 6]} />
                        <meshStandardMaterial color={OUT_DRY} roughness={0.95} />
                      </mesh>
                    </group>
                  </group>
                </group>

                {/* 椰子。

                    改版前三顆都掛在樹冠球外面 0.29–0.31 的地方，而球半徑 0.165、椰子半徑 0.098 ——
                    加起來才 0.263，也就是三顆椰子**沒有一顆碰得到樹**，它們是浮在葉子底下的三顆球。
                    現在距離收到 0.195–0.21，每一顆都陷進樹冠球裡約 6 公分、露出 13 公分，讀起來是
                    「結在樹上的」而不是「擺在那裡的」。 */}
                {([[0.121, -0.040, 0.060], [-0.090, -0.060, -0.080], [0.021, -0.099, -0.063]] as [number, number, number][]).map(
                  ([x, y, z], i) => (
                    <mesh key={`nut-${i}`} position={[x, y, z]} castShadow>
                      <sphereGeometry args={[0.098, 7, 6]} />
                      <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.85} />
                    </mesh>
                  )
                )}
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * 噴泉 —— 石砌水池、束腰基柱、上層水盤，四道水柱落回池裡。
 *
 * 改版前是四個 mesh：一個圓柱池子、一片藍色圓盤、一根柱子、頂上一個小甜甜圈。商店圖畫的是
 * 「池子 + 柱 + 上層水盤 + 噴出來的水」，模型少了後面兩樣，所以買回家的是一根插在水盆裡的桿子。
 *
 * **半徑刻意維持在 1.20**，跟改版前一模一樣。噴泉是 `audit:colliders` 裡「拒絕放置距離」第二長的
 * 東西（1.82 世界單位），把外圈鋪面做大一點點都會讓玩家更難在它旁邊擺東西 —— 所以鋪面收在
 * 1.20，池壁縮到 1.12，多出來的細節全部往內長。
 */
/* ------------------------------------------------------ 噴泉的水面高度，一處定義三處使用 */

/** 池面。 */
const FOUNTAIN_POOL_Y = 0.53;
/** 上層水盤的水面。 */
const FOUNTAIN_BOWL_Y = 1.47;
/** 四道水柱所在的半徑 —— 上盤邊緣。 */
const FOUNTAIN_SPOUT_R = 0.46;
const FOUNTAIN_SPOUTS: [number, number, number][] = [0, 1, 2, 3].map((i) => {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
  return [Math.cos(a) * FOUNTAIN_SPOUT_R, 0, Math.sin(a) * FOUNTAIN_SPOUT_R];
});
/** 水離開盤緣的那個點 —— 落下的水珠從這裡出發，所以它必須是水柱的頂端而不是它的中心。 */
const FOUNTAIN_SPOUT_LIPS: [number, number, number][] =
  FOUNTAIN_SPOUTS.map(([x, , z]) => [x, 1.34, z]);
const FOUNTAIN_SURFACES = [
  { at: [0, FOUNTAIN_POOL_Y, 0] as const, radius: 0.92 },
  { at: [0, FOUNTAIN_BOWL_Y, 0] as const, radius: 0.32 },
];

/**
 * 噴泉 —— the one piece in this pass whose INTERACTION is new rather than its animation.
 *
 * It already ran water all day and had nothing to press. It now offers 「玩水」, and the whole of
 * the reaction is one `<group>`: the jet column's own scale group, anchored at the nozzle mouth
 * so a surge grows upward instead of stretching about the column's middle and pulling its base
 * out of the spout.
 *
 * The group is OUTSIDE the existing pressure pulse, which still animates the cone inside it. Two
 * effects on one column, neither aware of the other, because they are on different objects.
 */
function FountainModel({ scale, item, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const jetRef = useRef<THREE.Mesh>(null);
  const anim = useObjectAnimation(instanceId, item, rootRef);

  /*
    噴柱本身的脈動。

    一根固定高度的錐體讀起來是玻璃，不是水；真正的噴嘴壓力永遠在小幅波動。這裡只動 y 方向的
    scale（0.88~1.12）並讓錐體跟著上下半個振幅，使它的**底端釘在噴嘴上**而頂端呼吸 ——
    底端一離開噴嘴，水柱就會出現「憑空開始」的斷點，也就是回報裡的「水流突然消失」。
  */
  useOutdoorAnimation(rootRef, ({ time }) => {
    const jet = jetRef.current;
    if (!jet) return;
    const pulse = 1 + Math.sin(time * 2.3) * 0.08 + Math.sin(time * 5.7) * 0.04;
    jet.scale.set(1, pulse, 1);
    // Local to the surge group below, whose origin is the nozzle mouth at y = 1.55.
    jet.position.y = 0.17 + (pulse - 1) * 0.17;
  }, { radius: 2.5 });

  return (
    <group ref={rootRef} scale={scale}>
      {/* 外圈鋪面。噴泉沒有它就是憑空長在草地上的一個桶子。 */}
      <mesh position={[0, 0.045, 0]} receiveShadow>
        <cylinderGeometry args={[1.14, 1.20, 0.09, 12]} />
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.95} />
      </mesh>
      {/* 池體 */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.08, 1.12, 0.44, 12]} />
        <meshStandardMaterial color={OUT_STONE} roughness={0.85} />
      </mesh>
      {/* 池緣。是個環而不是一片圓盤 —— 圓盤會把水面蓋住，而水面是這件東西的重點。 */}
      <mesh position={[0, 0.50, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[1.06, 0.075, 6, 14]} />
        <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.8} />
      </mesh>
      {/* 水面 */}
      <mesh position={[0, 0.505, 0]}>
        <cylinderGeometry args={[1.02, 1.02, 0.05, 12]} />
        <meshStandardMaterial color={OUT_WATER} emissive={OUT_WATER} emissiveIntensity={0.35} transparent opacity={0.62} roughness={0.15} />
      </mesh>
      {/* 基柱：腳座 → 束腰 → 柱身。三段而不是一根，是「有做過」跟「一根圓柱」的差別。 */}
      <mesh position={[0, 0.595, 0]} castShadow>
        <cylinderGeometry args={[0.30, 0.42, 0.20, 10]} />
        <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.70, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.21, 0.05, 5, 10]} />
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.155, 0.20, 0.52, 10]} />
        <meshStandardMaterial color={OUT_STONE} roughness={0.85} />
      </mesh>
      {/* 上層水盤：底下是一個倒過來的錐（rotation x = π，不然尖端朝上就成了一頂帽子），
          上面是外擴的盤身，邊緣再套一圈。 */}
      <mesh position={[0, 1.24, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[0.40, 0.22, 12]} />
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.85} />
      </mesh>
      {/* 盤身頂面壓在 1.455，水面頂在 1.47 —— 兩個朝上的面差 1.5 公分。差太少會 z-fight
          （`npm run audit:zfighting` 對這個場景的門檻是 0.8 公分），第一版差 0.5 公分就被抓了。 */}
      <mesh position={[0, 1.39, 0]} castShadow>
        <cylinderGeometry args={[0.50, 0.40, 0.13, 12]} />
        <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.455, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.49, 0.035, 5, 14]} />
        <meshStandardMaterial color={OUT_STONE} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.45, 0]}>
        <cylinderGeometry args={[0.38, 0.38, 0.04, 12]} />
        <meshStandardMaterial color={OUT_WATER} emissive={OUT_WATER} emissiveIntensity={0.35} transparent opacity={0.6} roughness={0.15} />
      </mesh>
      {/* 出水頭 */}
      <mesh position={[0, 1.56, 0]} castShadow>
        <sphereGeometry args={[0.095, 10, 8]} />
        <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.7} />
      </mesh>
      {/*
        頂上的小噴頭，以及從上盤邊緣落回池子的四道水。

        第一版做的是「四根從出水頭往外斜的錐體 + 兩根垂直的柱子」，畫出來是四根白刺加兩根玻璃柱：
        斜的水柱懸在半空中沒有落點，垂直的柱子沒有起點。一座分層噴泉之所以讀得出來，靠的是
        **上面的水看得見它落到下面哪裡** —— 所以現在是四道從上盤邊緣（半徑 0.46）垂到池面
        （y=0.56）的水，兩端都接在實體上。
      */}
      {/* 水柱與落水都要**看得見**。商店縮圖上這座噴泉的主角是三道飽和的藍色水線；模型這邊
          原本是 0.6 與 0.5 的透明度配上最淺的水色，在亮草地前幾乎透光，於是卡片賣的是「會噴水
          的噴泉」，島上放下去是一座乾的石盆。水是這件商品的名字，它得有實體感。 */}
      <group position={[0, 1.55, 0]} ref={anim.ref('jet')}>
        <mesh ref={jetRef} position={[0, 0.17, 0]}>
          <coneGeometry args={[0.075, 0.44, 6]} />
          <meshStandardMaterial color={OUT_WATER} emissive={OUT_WATER_LIGHT} emissiveIntensity={0.5} transparent opacity={0.88} roughness={0.2} />
        </mesh>
      </group>
      {/* 落水維持半透明。0.8 的不透明度會讓這四道水讀成四根撐住上盤的玻璃柱 —— 水要看得見，
          但不能看起來像結構件。染成飽和的水色、透明度留在 0.55，是「看得出是水」跟「不會被
          誤認成柱子」之間的那一格。 */}
      {FOUNTAIN_SPOUTS.map((s, i) => (
        <mesh key={`fall-${i}`} position={[s[0], 0.96, s[2]]}>
          <cylinderGeometry args={[0.030, 0.050, 0.80, 6]} />
          <meshStandardMaterial color={OUT_WATER} emissive={OUT_WATER} emissiveIntensity={0.25} transparent opacity={0.48} roughness={0.25} />
        </mesh>
      ))}

      {/*
        會動的水。

        上面那些是**水的形狀**：一根噴柱、四道從盤緣垂到池面的水。它們兩端都接在實體上，所以
        靜止時已經讀得出「水從哪裡來、落到哪裡去」—— 缺的只是「它正在流」的證據。

        下面三件事各補一段：噴出去的水珠、順著水流滑下去的水珠、以及水面上的漣漪。刻意都做得很小：
        一座庭園噴泉不是水舞表演，而且每一顆水珠都是一個 draw call。四顆噴珠 + 四顆落珠 +
        四個落點漣漪 + 四圈水面漣漪 = 16 個很小的 mesh，全部宣告 `depthWrite={false}` ——
        那既是疊層半透明水的正確畫法，也是碰撞（lib/collisionShape.ts）與品質稽核
        （scripts/audit-outdoor-quality.ts）用來分辨「畫上去的效果」與「物件的零件」的旗標，
        所以這些水不會改變玩家能站在哪裡，也不會灌水噴泉的結構分數。

        整段實作在 Three/outdoorAnimation.tsx，這裡只填三組數字 —— 未來的小溪、瀑布或水盆用的是
        同樣三個元件。
      */}
      <WaterJet from={[0, 1.66, 0]} rise={0.22} spread={0.30} landY={FOUNTAIN_BOWL_Y} count={4} rate={1.0} size={0.05} />
      <WaterFalls spouts={FOUNTAIN_SPOUT_LIPS} landY={FOUNTAIN_POOL_Y - 0.01} splash={0.20} size={0.055} rate={0.8} />
      <WaterRipples
        surfaces={FOUNTAIN_SURFACES}
        count={2}
        rate={0.34}
      />
    </group>
  );
}

/**
 * 木製平台 —— 鋪板的甲板、封邊、下面的橫樑與四支角柱。
 *
 * 改版前是一個 4×0.3×4 的實心方塊加四支腳。商店圖畫的是一片一片的木板，模型上是一整塊。
 *
 * **甲板頂面必須維持在 y = 0.30。** 這件商品是 `standable`（constants/items.ts），玩家會站上去，
 * 而站立高度、腳步聲、算不算掉進水裡全都是從模型量出來的最高面決定的（lib/furniturePlacement.ts）。
 * 所以底板做到 0.24，木板 0.22–0.30 疊上去重疊兩公分（不重疊的話兩個面共平面，`audit:zfighting`
 * 會抓），封邊的頂面壓在 0.295 —— 比甲板低半公分，讓甲板看起來是蓋在框上的。
 */
function WoodenPlatformModel({ scale }: FurnitureModelProps) {
  // 六塊面板，板寬 0.58、縫 0.07。縫是看得見結構的地方，太密就回到一整塊了。
  const PLANKS = [-1.625, -0.975, -0.325, 0.325, 0.975, 1.625];
  return (
    <group scale={scale}>
      {/* 底板 —— 木板下面的那一層，順便擋住從縫裡看穿的視線。 */}
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <boxGeometry args={[3.94, 0.24, 3.94]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {PLANKS.map((z, i) => (
        <mesh key={`plank-${i}`} position={[0, 0.26, z]} castShadow receiveShadow>
          <boxGeometry args={[3.84, 0.08, 0.58]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD_LIGHT : OUT_WOOD} roughness={0.9} />
        </mesh>
      ))}
      {/* 四面封邊。深一階的木色，把甲板框起來 —— 這是「一片木板」跟「一座平台」的分界。 */}
      {[-1, 1].map((s) => (
        <mesh key={`fascia-z-${s}`} position={[0, 0.215, s * 1.985]} castShadow receiveShadow>
          <boxGeometry args={[4.04, 0.16, 0.07]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`fascia-x-${s}`} position={[s * 1.982, 0.215, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.064, 0.15, 3.92]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* 兩根橫樑，從底板下面露出來。玩家看不到的結構不用做，看得到的要做。 */}
      {[-1, 1].map((s) => (
        <mesh key={`joist-${s}`} position={[0, -0.03, s * 1.5]} castShadow>
          <boxGeometry args={[3.8, 0.16, 0.18]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.95} />
        </mesh>
      ))}
      {/* 角柱 */}
      {[-1.8, 1.8].map((x) => [-1.8, 1.8].map((z) => (
        <mesh key={`post-${x}-${z}`} position={[x, -0.2, z]} castShadow>
          <cylinderGeometry args={[0.10, 0.12, 0.8, 8]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
        </mesh>
      )))}
    </group>
  );
}

/**
 * 吊床 —— 兩根有腳座與尖帽的木柱、垂成弧線的織帶、撐開兩端的橫木、繩結與枕頭。
 *
 * 改版前是三個 mesh：兩根方柱，中間架一片**平的**板子。商店圖畫的是垂下來的網、交叉的織紋和
 * 一顆黃色抱枕 —— 一張不會下垂的吊床是這次改版裡最刺眼的一件。
 *
 * ## 弧線怎麼來的，以及為什麼不能隨便動
 *
 * 織帶的上表面是一條拋物線：
 *
 *     top(x) = SAG_LOW + SAG_K · x²
 *
 * 五段短板各自放在自己那一段的中點，並繞 Z 轉到該點的切線角 `atan(2·SAG_K·x)`，所以段與段是接上
 * 的而不是階梯狀的。段長 0.46 但間距 0.42，刻意重疊。
 *
 * **SAG_LOW 是被釘死的，不是調出來的。** 這件商品在 constants/items.ts 宣告了
 * `interactions: [{ kind: 'rest', surfaceY: 0.69, lateral: -1.1 }]` —— 躺下去的身體落在
 * 「畫出來的尺寸」下的 y=0.69、x=-1.1。這個模型畫在 scale 0.85 × 1.55（BUILDING 加成）= 1.3175，
 * 所以那個點在本地座標是 x = -1.1/1.3175 = -0.835、y = 0.69/1.3175 = 0.5237。SAG_LOW 就是回推出來的：
 *
 *     0.411 + 0.1633 × 0.835² = 0.5249  →  × 1.3175 = 0.6916 ≈ 0.69  ✓
 *
 * 改動 SAG_LOW 或 SAG_K 而不同時改 items.ts 的 surfaceY，身體就會浮在織帶上面或陷進去。
 * `npm run audit:interactions` 會抓（它會確認躺點落在這件家具自己身上），但先算對比較快。
 */
/**
 * 吊床的吊點 —— 兩根柱頂之間那條線，也就是整張床搖擺時繞的軸。
 *
 * 跟 constants/outdoorAnimation.ts 的 `SUSPENDED_MOTIONS.hammock.pivotY`（1.686 世界單位）是
 * 同一個點的兩種寫法：這裡是模型自己的局部單位，那裡是它被畫出來的世界單位，比值就是 BUILDING
 * 類的繪製倍率。兩邊對不上的話，床會繞著一條跟繩子無關的線擺 —— 而躺在上面的人會繞另一條。
 */
const HAMMOCK_PIVOT_Y = 1.28;
/** 把模型原本的絕對高度換算成「吊點底下多少」。 */
const sling = (y: number) => y - HAMMOCK_PIVOT_Y;

/** 一次取樣風的暫存，模組層級 —— 每一幀每個模型呼叫一次，不配置新物件。 */
const FURNITURE_WIND: WindSample = { sway: 0, cross: 0, gust: 0 };

function HammockModel({ scale, instanceId }: FurnitureModelProps) {
  const SAG_LOW = 0.411;
  const SAG_K = 0.1633;
  const top = (x: number) => SAG_LOW + SAG_K * x * x;
  const SEGMENTS = [-0.84, -0.42, 0, 0.42, 0.84];

  const rootRef = useRef<THREE.Group>(null);
  const slingRef = useRef<THREE.Group>(null);
  const timeline = useFurnitureOccupancy(instanceId);

  /*
    整張吊床繞著柱頂那條線擺，而不是原地上下抖。

    改版前**吊床本身完全不動**：會動的是躺在上面的角色（Three/Avatar.tsx 直接把 groupRef 的
    y 與 z 各加了一點 `sin(t * 1.5)`），而且那兩個位移寫在**世界座標**裡 —— 也就是說一張在建造
    模式下轉過 90 度的吊床，它的乘客會橫著在布面上滑。回報的「吊床移動但玩家不動 / 兩者不同步」
    是這件事的兩面。

    現在動的是布，而角色讀的是**同一個函式的同一個回傳值**（lib/outdoorMotion.ts 的
    `suspendedAngle`，兩邊都用事件上帶著的同一個時間戳）。兩者不需要「對時」，因為根本只有一個
    數字。躺上去的瞬間有一次受力：`impulse` 是 `ride` 的三倍，2.2 秒內衰減掉，之後只剩下幾乎
    看不見的微幅晃動 —— 這就是「一次自然的受力反應 → 緩慢柔和的擺動 → 逐漸穩定」。
  */
  useOutdoorAnimation(rootRef, ({ position }) => {
    const node = slingRef.current;
    if (!node) return;
    sampleWind(position.x, position.z, 0, FURNITURE_WIND);
    const phase = suspendedPhase(timeline.current, performance.now(), FURNITURE_WIND.sway);
    node.rotation.x = suspendedAngle(SUSPENDED_MOTIONS.hammock, phase);
    // `suspendedSag` 是世界單位（角色控制器直接用），這裡在 `scale` 群組內，所以要換回局部單位。
    node.position.y = HAMMOCK_PIVOT_Y + suspendedSag(SUSPENDED_MOTIONS.hammock, phase) / (scale || 1);
  }, { radius: 2.4 });

  return (
    <group ref={rootRef} scale={scale}>
      {/* 兩根立柱：腳座、柱身、尖帽。改版前是兩根 0.8 高的方柱，比織帶只高一點點，
          看起來像兩塊擋板；柱子拉到 1.30 高、繩子從柱頂垂下來，輪廓才讀成一張吊床。
          柱子不動 —— 會動的只有掛在它們之間的東西。 */}
      {[-1.20, 1.20].map((x) => (
        <group key={`post-${x}`} position={[x, 0, 0]}>
          <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.13, 0.15, 0.14, 8]} />
            <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.69, 0]} castShadow>
            <cylinderGeometry args={[0.055, 0.075, 1.30, 8]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.36, 0]} castShadow>
            <coneGeometry args={[0.09, 0.16, 6]} />
            <meshStandardMaterial color={OUT_WOOD} roughness={0.85} />
          </mesh>
        </group>
      ))}

      {/* 吊點以下的所有東西 —— 繩子、織帶、撐木、抱枕。它們是一個剛體，繞 x 軸擺動。 */}
      <group ref={slingRef} position={[0, HAMMOCK_PIVOT_Y, 0]}>
        {/* 吊繩。從柱頂斜向內下，接到織帶收攏的那一頭。角度是算出來的：
            柱頂 (±1.20, 1.28) 到收攏點 (±1.10, 0.585)，方向 (∓0.10, -0.695)。 */}
        {[-1, 1].map((s) => (
          <mesh key={`rope-${s}`} position={[s * 1.15, sling(0.9325), 0]} rotation={[0, 0, s * -0.143]} castShadow>
            <cylinderGeometry args={[0.022, 0.022, 0.702, 6]} />
            <meshStandardMaterial color={OUT_DRY} roughness={1} />
          </mesh>
        ))}
        {/* 織帶本體。 */}
        {SEGMENTS.map((x, i) => (
          <mesh
            key={`web-${i}`}
            position={[x, sling(top(x) - 0.028), 0]}
            rotation={[0, 0, Math.atan(2 * SAG_K * x)]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.46, 0.055, 0.70]} />
            <meshStandardMaterial color={i % 2 === 0 ? OUT_CANVAS : OUT_CANVAS_DARK} roughness={0.95} />
          </mesh>
        ))}
        {/* 兩端撐開織帶的橫木。沒有它，五段布就只是五段布。 */}
        {[-1.00, 1.00].map((x) => (
          <mesh key={`spreader-${x}`} position={[x, sling(top(x) - 0.075), 0]} castShadow>
            <boxGeometry args={[0.06, 0.06, 0.78]} />
            <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
          </mesh>
        ))}
        {/* 兩道織紋橫肋，壓在織帶表面上 —— 商店圖上的交叉網格，在 3D 裡只需要兩根就讀得出來。 */}
        {[-0.50, 0.50].map((x) => (
          <mesh key={`weave-${x}`} position={[x, sling(top(x) + 0.022), 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.016, 0.016, 0.68, 6]} />
            <meshStandardMaterial color={OUT_DRY} roughness={1} />
          </mesh>
        ))}
        {/* 兩頭收攏成一束的織帶，尖端朝外接上吊繩。錐體的尖端本來朝 +y，繞 Z 轉 ∓90° 才會朝 ±x。 */}
        {[-1, 1].map((s) => (
          <mesh key={`gather-${s}`} position={[s * 1.10, sling(0.585), 0]} rotation={[0, 0, s * -Math.PI / 2]} castShadow>
            <coneGeometry args={[0.17, 0.28, 6]} />
            <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={0.95} />
          </mesh>
        ))}
        {/* 抱枕。放在 +x 那一頭 —— 躺姿的錨點是「腳」(lateral -1.1)，身體往 +x 延伸，頭在那邊。
            再往外一點靠在收攏處，不會跟頭部的模型打架。 */}
        <mesh position={[0.98, sling(top(0.98) + 0.078), 0]} rotation={[0, 0, 0.31]} castShadow>
          <boxGeometry args={[0.26, 0.14, 0.42]} />
          <meshStandardMaterial color="#f5c85c" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ 木製鞦韆 */

/**
 * 橫樑中心，也就是繩子的吊點。世界單位 2.635 = SUSPENDED_MOTIONS.swing.pivotY。
 *
 * 從 1.65 加高到 2.0 的理由是量出來的：坐在鞦韆上的角色，頭骨（半徑 0.54 世界單位）中心離橫樑
 * 軸心只有 0.41，而頭骨半徑加上橫樑半徑（0.12）就要 0.66 —— 也就是**頭頂穿進橫樑 10 公分**。
 * 這個 Q 版角色的頭比身體大，坐著的頭頂高度（2.3）已經高過原本橫樑的底面（2.06）。修法不是
 * 把角色壓低（那會把腿壓進座板），是讓鞦韆架符合坐在上面那個身體的尺寸。
 * `npm run audit:interactions` 會把角色的頭放在擺動的每個角度上檢查這件事。
 */
const SWING_BEAM_Y = 2.0;
/**
 * 座板中心的高度。
 *
 * 座面（板頂）落在局部 0.5313，也就是世界 0.700 —— 就是目錄裡 `deco-swing` 的 `surfaceY`。
 * 高度夠讓坐上去的角色雙腳離地；角色坐在哪裡、腿怎麼垂，是從角色的身體體積解出來的
 * （lib/occupantFit.ts）：髖部放在「腿的表面剛好靠在座板前緣」的位置，這是沒有膝蓋的腿
 * 唯一不會穿過座板的坐法。
 */
const SWING_SEAT_Y = 0.4938;
/** 繩長 —— 由上面兩個數字決定，不是另外填的。 */
const SWING_ROPE_LEN = SWING_BEAM_Y - SWING_SEAT_Y;
/**
 * 座板兩片板條的中心（局部 z）。座板總深 0.245 局部 = 0.32 世界，前緣在局部 0.1225、世界 0.161
 * —— 就是目錄裡的 `seatFront`。
 *
 * 原本是三片、深 0.49 世界：比真實的鞦韆座（約 20 公分）深一倍多。角色的髖部必須坐在座板前緣
 * （見上），座板越深，身體就離兩條繩子越遠，手得往後伸才握得到繩。改成兩片，前緣離繩子近了
 * 8 公分，手是在身體兩側握著繩子。
 */
const SWING_SLATS_Z = [-0.0655, 0.0655] as const;
/**
 * A 字腳架的斜柱。頂端落在橫樑兩側、底端往外張開，斜度維持原本的 0.18 rad，只是跟著橫樑加長。
 * 柱長與中心是由「頂端到 y≈2.06、z≈±0.29」與斜度解出來的，繫樑長度則剛好插到兩根柱子的軸心。
 */
const SWING_LEG_LEN = 2.10;
const SWING_LEG_Y = 1.03;
const SWING_LEG_Z = 0.478;
const SWING_LEG_TILT = 0.18;
/** 繫樑的高度，以及在那個高度上斜柱軸心的 z —— 繫樑兩端插進柱子裡，不會懸空。 */
const SWING_TIE_Y = 0.55;
const SWING_TIE_HALF = SWING_LEG_Z + (SWING_LEG_Y - SWING_TIE_Y) * Math.tan(SWING_LEG_TILT);

function SwingModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const seatGroupRef = useRef<THREE.Group>(null);
  const timeline = useFurnitureOccupancy(instanceId);
  const wasRidden = useRef(false);

  /*
    座椅的擺動。

    改版前這裡是 `boost` + `lerp` + `Math.sin(t * speed) * amplitude`，由「玩家按了 E」這個
    **瞬間**驅動：推一下、盪三秒、停。現在它由「玩家在不在上面」這個**區間**驅動，而且用的是
    lib/outdoorMotion.ts 裡跟角色控制器同一個解算器 —— 從靜止開始，五秒半內把幅度養到 24 度，
    節奏是這條繩長自己的單擺週期（約 2.5 秒）再加一點風造成的抖動，所以它不會像節拍器。

    人下來之後幅度以五秒的時間常數衰減回「有風但沒人」的微幅晃動，而不是直接停。
  */
  useOutdoorAnimation(rootRef, ({ position }) => {
    const seat = seatGroupRef.current;
    if (!seat) return;
    sampleWind(position.x, position.z, 0, FURNITURE_WIND);
    const phase = suspendedPhase(timeline.current, performance.now(), FURNITURE_WIND.sway);
    seat.rotation.x = suspendedAngle(SUSPENDED_MOTIONS.swing, phase);

    // 木頭吃到重量、以及卸掉重量的那一聲。上下緣各響一次 —— 每一次擺盪都叫的鞦韆會很吵。
    const ridden = timeline.current.mountedAt != null;
    if (ridden !== wasRidden.current) {
      wasRidden.current = ridden;
      playSwingCreak(ridden ? 0.42 : 0.3);
    }
  }, { radius: 2.6 });

  return (
    <group ref={rootRef} scale={scale}>
      {/* A 字腳架。每一側兩根腳斜著站，中間再橫一根繫樑把它們綁成一個 A —— 沒有那根橫樑，
          四根斜柱就只是四根各自站著的棍子，這是改版前這件東西缺的「次級結構」。 */}
      {[-1.05, 1.05].map((x) => (
        <group key={x}>
          <mesh position={[x, SWING_LEG_Y, -SWING_LEG_Z]} rotation={[SWING_LEG_TILT, 0, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.08, SWING_LEG_LEN, 8]} />
            <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
          </mesh>
          <mesh position={[x, SWING_LEG_Y, SWING_LEG_Z]} rotation={[-SWING_LEG_TILT, 0, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.08, SWING_LEG_LEN, 8]} />
            <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
          </mesh>
          {/* 繫樑。放在腳架下半部，兩端插到斜柱的軸心 —— 真的插進柱子裡，而不是停在柱子前面
              四公分的半空中（改版前 0.78 長的繫樑構不到 ±0.50 的柱子）。 */}
          <mesh position={[x, SWING_TIE_Y, 0]} castShadow>
            <boxGeometry args={[0.075, 0.075, SWING_TIE_HALF * 2]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* 橫樑 */}
      <mesh position={[0, SWING_BEAM_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 2.3, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* 橫樑兩端的封頭。木頭的斷面顏色跟側面不一樣，這一圈深色就是在講那件事。 */}
      {[-1.12, 1.12].map((x) => (
        <mesh key={`cap-${x}`} position={[x, SWING_BEAM_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.105, 0.105, 0.09, 8]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
        </mesh>
      ))}
      {/* 繩子 + 會盪的座椅，繞著橫樑轉。 */}
      <group position={[0, SWING_BEAM_Y, 0]} ref={seatGroupRef}>
        {[-0.45, 0.45].map((x) => (
          <mesh key={`rope-${x}`} position={[x, -SWING_ROPE_LEN / 2, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, SWING_ROPE_LEN, 6]} />
            <meshStandardMaterial color={OUT_DRY} roughness={1} />
          </mesh>
        ))}
        {/* 繩結。繩子穿過座板的地方 —— 少了它，繩子看起來是插進木板裡的。 */}
        {[-0.45, 0.45].map((x) => (
          <mesh key={`knot-${x}`} position={[x, -SWING_ROPE_LEN + 0.045, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.038, 0.018, 5, 8]} />
            <meshStandardMaterial color={OUT_DRY} roughness={1} />
          </mesh>
        ))}
        {/* 座板做成兩片，深淺交錯 —— 板與板之間留一條縫，才有「釘起來的」讀感。見 SWING_SLATS_Z。 */}
        {SWING_SLATS_Z.map((z, i) => (
          <mesh key={`slat-${i}`} position={[0, -SWING_ROPE_LEN, z]} castShadow receiveShadow>
            <boxGeometry args={[1.1, 0.075, 0.115]} />
            <meshStandardMaterial color={i === 1 ? OUT_WOOD_LIGHT : '#e0ac71'} roughness={0.85} />
          </mesh>
        ))}
        {/* 座板底下的兩根托條，把兩片板連起來。 */}
        {[-0.38, 0.38].map((x) => (
          <mesh key={`cleat-${x}`} position={[x, -SWING_ROPE_LEN - 0.052, 0]} castShadow>
            <boxGeometry args={[0.09, 0.05, 0.24]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// Warm gradient reused every frame for the campfire's flame particles - allocated once so the
// per-frame flicker loop below never creates a new THREE.Color just to be garbage-collected.
const CAMPFIRE_CORE_COLOR = new THREE.Color('#fff7cc');
const CAMPFIRE_MID_COLOR = new THREE.Color('#ffb703');
const CAMPFIRE_OUTER_COLOR = new THREE.Color('#e85d04');

function CampfireModel({ scale, item, instanceId }: FurnitureModelProps) {
  // Six, not nine: the two solid `FlameCore` cones below now carry the flame's shape, so the
  // particles only have to be the sparks around it.
  const flameCount = 6;
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  // 添柴火 is a row in constants/objectAnimations.ts now: the log stack's dip, the stick, the flare
  // and the sound all come off the shared timeline rather than a trigger timestamp kept here.
  const anim = useObjectAnimation(instanceId, item);

  const flameSeeds = useMemo(
    () => Array.from({ length: flameCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: Math.random() * 0.18,
      speed: 2.4 + Math.random() * 1.6,
      offset: Math.random() * 10,
    })),
    []
  );

  /*
   * The fire's own life — the flicker and the rising sparks — on the SHARED culled loop.
   *
   * This was a raw `useFrame`, which meant every campfire on the island animated every frame of
   * the session whether it was beside the player or behind the house. How hard it FLARES is no
   * longer decided here either: `anim.level()` is the object's eased state signal, the same
   * number that dips the log stack, so the fire brightens exactly as the stick lands and settles
   * on the object's own close time instead of on a private lerp.
   */
  useOutdoorAnimation(anim.root, ({ time: t }) => {
    const boost = anim.level();

    flameSeeds.forEach((seed, i) => {
      const mesh = flameRefs.current[i];
      if (!mesh) return;
      const life = (t * seed.speed * 0.15 + seed.offset) % 1;
      // Deliberately a SMALLER flare than the old private boost used (0.9 / 0.35): that one was a
      // spike that decayed within a second, and the shared signal holds at full for the whole
      // `hold`. Held at the old amplitude, six additive sparks overlap into a white blob — the exact
      // 「白棉花」 FlameCore's comment warns about — so the fire now brightens and lifts rather
      // than blooming.
      const flare = 1 + boost * 0.4;
      const y = life * (0.55 + boost * 0.2);
      const spread = (1 - life) * seed.radius * (1 - boost * 0.25);
      mesh.position.set(Math.cos(seed.angle) * spread, y, Math.sin(seed.angle) * spread);
      mesh.scale.setScalar(((1 - life) * 0.16 + 0.03) * flare);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const preset = life < 0.25 ? CAMPFIRE_CORE_COLOR : life < 0.55 ? CAMPFIRE_MID_COLOR : CAMPFIRE_OUTER_COLOR;
      mat.color.copy(preset);
      mat.emissive.copy(preset);
      mat.opacity = (1 - life) * 0.95;
    });

    if (lightRef.current) {
      const flicker = 0.85 + Math.sin(t * 9) * 0.1 + Math.sin(t * 23) * 0.05;
      lightRef.current.intensity = (1.6 + boost * 1.8) * flicker;
    }
  }, { radius: 1.2, cullDistance: 44 });

  return (
    <group ref={anim.root} scale={scale}>
      {/*
        石圈。改版前是六顆一模一樣、同一個灰色的球排成正圓 —— 六顆一樣的球排成正圓，讀起來是
        「程式排出來的」而不是「有人搬石頭堆的」。現在是七顆多面體，半徑、大小、轉角、顏色
        全部各自不同：不規則本身就是手作感，而且一顆多面體的稜面在低多邊形裡本來就比球好看。
      */}
      {([
        [0.00, 0.435, 0.150, 0.4, OUT_STONE],
        [0.90, 0.410, 0.125, 1.1, OUT_STONE_LIGHT],
        [1.75, 0.450, 0.140, 2.0, OUT_STONE_DARK],
        [2.55, 0.400, 0.115, 0.7, OUT_STONE],
        [3.35, 0.445, 0.152, 1.5, OUT_STONE_LIGHT],
        [4.25, 0.425, 0.120, 2.6, OUT_STONE_DARK],
        [5.30, 0.440, 0.138, 0.2, OUT_STONE],
      ] as [number, number, number, number, string][]).map(([a, dist, r, spin, colour], i) => (
        <mesh
          key={`stone-${i}`}
          position={[Math.cos(a) * dist, r * 0.62, Math.sin(a) * dist]}
          rotation={[spin * 0.3, spin, spin * 0.2]}
          castShadow
          receiveShadow
        >
          <dodecahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={colour} roughness={0.95} />
        </mesh>
      ))}
      {/* 灰燼盤與底下透出來的餘燼。石圈中間如果是草地，這堆火就是浮在草上的；
          一片灰加一圈暗紅，火才有燒過的地面。 */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.36, 12]} />
        <meshStandardMaterial color="#4b4441" roughness={1} {...DECAL_DEPTH_BIAS} />
      </mesh>
      <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.21, 10]} />
        <meshStandardMaterial color="#b3401a" emissive="#ff6a1f" emissiveIntensity={0.9} roughness={1} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/* 底下兩根交叉的柴（原本就有的），上面再架三根靠成一個火堆架。
          兩根平躺的柴看起來是掉在那裡的；三根立起來靠在一起，才讀成有人生的火。
          整堆柴是 `tepee` 這個部件：添柴火時它會被新加的那根壓得往下沉一下再回來。 */}
      <group ref={anim.ref('tepee')}>
        <mesh position={[0, 0.115, 0]} rotation={[0, 0.5, Math.PI / 2 + 0.1]} castShadow>
          <cylinderGeometry args={[0.06, 0.07, 0.7, 8]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.125, 0]} rotation={[0, -0.5, Math.PI / 2 - 0.1]} castShadow>
          <cylinderGeometry args={[0.06, 0.07, 0.7, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + 0.9;
          return (
            <mesh
              key={`tepee-${i}`}
              position={[Math.cos(a) * 0.10, 0.27, Math.sin(a) * 0.10]}
              rotation={[Math.sin(a) * 0.62, 0, -Math.cos(a) * 0.62]}
              castShadow
            >
              <cylinderGeometry args={[0.042, 0.055, 0.56, 6]} />
              <meshStandardMaterial color={i === 1 ? OUT_CHARRED : OUT_WOOD_DARK} roughness={0.95} />
            </mesh>
          );
        })}
      </group>
      {/* 丟進火裡的那根柴。掛在 `tossAim` 底下：這個 group 在按下的那一刻被轉向玩家那一側
          （constants/objectAnimations.ts 的 `launch`），所以柴永遠是從玩家蹲著的那一邊飛進火裡的，
          而營火沒有正面，這一點不能用模型座標寫死。 */}
      <group ref={anim.ref('tossAim')}>
        {anim.since != null && (
          <ObjectToss key={anim.since} since={anim.since} from={[0, 0.5, -0.62]} to={[0, 0.3, 0]} arc={0.28} over={0.34} spins={0.6}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.035, 0.045, 0.34, 6]} />
              <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
            </mesh>
          </ObjectToss>
        )}
      </group>
      {/* 火。實體的火心先畫，粒子只是它的光暈 —— 見 Three/Torch.tsx 的 FlameCore：加色混合的
          粒子在白天的亮草地前會飽和成白色，商店縮圖上那朵橘紅色的火因此在島上讀成一團白棉花。
          兩朵錯開相位的火心，因為營火比火把寬，一朵尖錐撐不住那個石圈的寬度。 */}
      <FlameCore position={[-0.055, 0.20, 0.02]} height={0.36} radius={0.115} speed={5.4} />
      <FlameCore position={[0.07, 0.26, -0.03]} height={0.46} radius={0.135} speed={6.1} phase={2.1} />
      {/* Flame particles */}
      {flameSeeds.map((_, i) => (
        <mesh key={i} ref={(el) => { flameRefs.current[i] = el; }}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} emissiveIntensity={2.2} />
        </mesh>
      ))}
      {/* 添柴火之後噴起的幾顆火星。等那根柴落進火裡（0.3 秒）才出來，由狀態掛上、由按下的那一刻
          計時，所以連按兩次是兩次，不會疊成一團。 */}
      {anim.since != null && (
        <ObjectBurst
          key={anim.since}
          since={anim.since}
          at={[0, 0.32, 0]}
          shape="ember"
          count={6}
          rise={1.25}
          spread={0.32}
          over={1.1}
          delay={0.3}
          stagger={0.07}
          size={0.045}
          color="#FDBA74"
          emissive="#F97316"
        />
      )}
      <pointLight ref={lightRef} position={[0, 0.5, 0]} distance={4.5} color="#ff8c00" />
    </group>
  );
}

/* -------------------------------------------------- 黃銅望遠鏡的骨架，算出來而不是填出來 */

const TELESCOPE_YOKE_Y = 0.92;
/** 腳掌落地的半徑。 */
const TRIPOD_FOOT_R = 0.40;
/** 腳的頂端收攏到的半徑 —— 遠小於雲台球的 0.11，所以三隻腳的斷面都埋在球裡看不見。 */
const TRIPOD_HEAD_R = 0.05;
/** 腳掌略微陷進地面，免得三個朝下的圓面剛好貼在草地上。 */
const TRIPOD_FOOT_Y = 0.015;
const TRIPOD_RUN = TRIPOD_FOOT_R - TRIPOD_HEAD_R;
const TRIPOD_RISE = TELESCOPE_YOKE_Y - TRIPOD_FOOT_Y;
const TRIPOD_LEG_LENGTH = Math.hypot(TRIPOD_RUN, TRIPOD_RISE);
/** 腳偏離鉛直的正弦。 */
const TRIPOD_SPLAY = TRIPOD_RUN / TRIPOD_LEG_LENGTH;

/** 一隻腳在高度 y 上的半徑。撐條要架在腳上，就得問腳「你在那個高度在哪裡」。 */
function tripodLegRadius(y: number): number {
  const t = (y - TRIPOD_FOOT_Y) / TRIPOD_RISE;
  return TRIPOD_FOOT_R + (TRIPOD_HEAD_R - TRIPOD_FOOT_R) * t;
}

/**
 * 三隻腳的中點與尤拉角。
 *
 * 圓柱自己的軸是 +Y；套上 [rx, 0, rz]（three.js 的 XYZ 順序，先繞 Z 再繞 X）之後軸會指到
 * (-sin rz, cos rz·cos rx, cos rz·sin rx)。要它指到腳的真實方向 (-s·cos a, √(1-s²), -s·sin a)，
 * 兩式對起來就是下面兩個 asin —— 而且是**精確解**而不是小角度近似：把 rz、rx 代回去，y 分量
 * 自動收斂成 √(1-s²)。
 */
const TRIPOD_LEGS = [0, 1, 2].map((i) => {
  const a = (i / 3) * Math.PI * 2;
  const rz = Math.asin(TRIPOD_SPLAY * Math.cos(a));
  const rx = -Math.asin((TRIPOD_SPLAY * Math.sin(a)) / Math.cos(rz));
  const midR = (TRIPOD_FOOT_R + TRIPOD_HEAD_R) / 2;
  return {
    position: [
      Math.cos(a) * midR, (TRIPOD_FOOT_Y + TELESCOPE_YOKE_Y) / 2, Math.sin(a) * midR,
    ] as [number, number, number],
    rotation: [rx, 0, rz] as [number, number, number],
  };
});

const TRIPOD_BRACE_Y = 0.30;
const TRIPOD_BRACES = [0, 1, 2].map((i) => {
  const r = tripodLegRadius(TRIPOD_BRACE_Y);
  const a1 = (i / 3) * Math.PI * 2;
  const a2 = ((i + 1) / 3) * Math.PI * 2;
  const p1 = [Math.cos(a1) * r, Math.sin(a1) * r];
  const p2 = [Math.cos(a2) * r, Math.sin(a2) * r];
  return {
    position: [(p1[0] + p2[0]) / 2, TRIPOD_BRACE_Y, (p1[1] + p2[1]) / 2] as [number, number, number],
    rotation: [0, -Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), Math.PI / 2] as [number, number, number],
    // 端點正好落在兩隻腳的軸線上，所以兩頭都埋進腳裡（腳在這個高度的半徑約 0.045）。
    length: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
  };
});

/** 鏡筒是一根錐管：物鏡端細、目鏡端粗。 */
const TUBE_LENGTH = 1.10;
const TUBE_R_TOP = 0.10;
const TUBE_R_BOTTOM = 0.14;
/** 銅箍站出鏡筒表面多少。夠遠就不會共面，夠近才還是一道箍而不是一個輪子。 */
const BAND_STANDOFF = 0.012;
const BAND_HEIGHT = 0.055;
const tubeRadius = (y: number) => TUBE_R_BOTTOM + (TUBE_R_TOP - TUBE_R_BOTTOM) * (y / TUBE_LENGTH);
const TUBE_BANDS = [0.22, 0.82].map((y) => ({
  y,
  rTop: tubeRadius(y + BAND_HEIGHT / 2) + BAND_STANDOFF,
  rBottom: tubeRadius(y - BAND_HEIGHT / 2) + BAND_STANDOFF,
}));

/**
 * 鏡筒靜止時偏離鉛直多少（弧度），朝著 `tubeTilt` 自己的 +Z —— 也就是 `headAim` 被轉向的那個方向。
 *
 * 靜止姿勢必然朝向 aim group 的 +Z，這不是選擇：runtime 寫進去的是「靜止角 + 解出來的朝向」，
 * 所以只有「靜止時就指著 +Z」的鏡筒，轉完之後才會指著玩家看的方向。
 */
const TUBE_REST_TILT = 0.55;

/**
 * 物鏡的反光 —— 只在鏡筒抬起來的時候才掛上去，亮度跟著物件自己的狀態訊號走。
 *
 * 以前這片圓一直掛在鏡筒上、透明度 0，每一幀被問一次亮不亮。現在它是由狀態掛上的效果：沒人在
 * 觀星的望遠鏡上根本沒有這個 mesh，也沒有它的動畫登記。
 */
function LensGlint({ level }: { level: () => number }) {
  const ref = useRef<THREE.Mesh>(null);
  useOutdoorAnimation(ref, ({ time }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const l = level();
    (mesh.material as THREE.MeshStandardMaterial).opacity = l * (0.45 + Math.max(0, Math.sin(time * 5)) * 0.35);
  }, { radius: 0.5, cullDistance: 36 });
  return (
    // `circleGeometry` 預設躺在 XY 平面、面朝 +Z，而鏡筒的軸是 +Y，繞 X 轉 -90° 才會朝著鏡筒指的方向。
    <mesh ref={ref} position={[0, 1.11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.1, 12]} />
      <meshStandardMaterial color="#e0f2fe" emissive="#7dd3fc" emissiveIntensity={1.5} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function TelescopeModel({ scale, item, instanceId }: FurnitureModelProps) {
  /*
   * 觀星 is a row in constants/objectAnimations.ts. What used to be here was a `useFrame` that
   * swept the tube side to side on a sine forever — whether or not anyone was looking through it —
   * plus a private boost that wobbled it faster when pressed. A telescope does not move by itself,
   * and a wobble is not what someone adjusting one does: they turn it to where they want to look,
   * lift it, and scan slowly. `headAim` is turned toward the player's own facing at the press,
   * `tubeTilt` lifts, `tubePan` scans, `focusKnob` turns.
   */
  const anim = useObjectAnimation(instanceId, item);

  return (
    <group ref={anim.root} scale={scale}>
      {/*
        三腳架。

        改版前這三隻腳的傾角號**寫反了**：`rotation z = -cos(a) * 0.35` 讓每一隻腳的「上端」往
        外倒，於是三隻腳的**腳掌**在中心擠成一團、**頂端**張開到半徑 0.48 —— 一個上寬下窄的漏斗，
        而且頂端離雲台（半徑 0.11 的球）足足 0.37，三隻腳跟望遠鏡本體完全沒有接觸。從側面看是
        三根斜插在地上的棍子旁邊浮著一支望遠鏡，這就是回報的「破圖」。

        現在的角度是**算出來的**而不是填的：腳掌落在 TRIPOD_FOOT_R，頂端收進雲台球心附近的
        TRIPOD_HEAD_R，兩點決定方向、決定長度、也決定 mesh 的中點。三個數字改任何一個，其他
        全部跟著對，不會再有「腳的位置動了但撐條沒動」這種事。
      */}
      {TRIPOD_LEGS.map((leg, i) => (
        <mesh key={i} position={leg.position} rotation={leg.rotation} castShadow>
          <cylinderGeometry args={[0.035, 0.05, TRIPOD_LEG_LENGTH, 8]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
        </mesh>
      ))}
      {/* 三根撐條，把三隻腳在下半部連成一個三角形。一支三腳架真正撐得住是靠這個。
          撐條的半徑是從**腳的實際軸線**在那個高度上取的（tripodLegRadius），改版前是另外
          填的一個常數 0.357，跟當時腳的真實位置差了 10 公分，所以三根撐條是浮在腳外面的。 */}
      {TRIPOD_BRACES.map((brace, i) => (
        <mesh key={`brace-${i}`} position={brace.position} rotation={brace.rotation} castShadow>
          <cylinderGeometry args={[0.022, 0.022, brace.length, 6]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.9} />
        </mesh>
      ))}
      {/* 雲台 */}
      <mesh position={[0, TELESCOPE_YOKE_Y, 0]} castShadow>
        <sphereGeometry args={[0.11, 12, 12]} />
        <meshStandardMaterial color="#D97706" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* 對焦旋鈕。掛在雲台側邊，是這件東西唯一「可以動手轉」的細節。
          內側端點壓進雲台球裡（距球心 0.097 < 半徑 0.11）—— 改版前是 0.1125，差 1 公分，
          所以旋鈕是浮在雲台旁邊的一顆獨立圓餅。 */}
      <group position={[0.115, TELESCOPE_YOKE_Y - 0.035, 0]} ref={anim.ref('focusKnob')}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.05, 10]} />
          <meshStandardMaterial color={OUT_METAL_DARK} metalness={0.6} roughness={0.35} />
        </mesh>
      </group>
      {/* 黃銅鏡筒。三層 group，各管一件事，而且順序就是一個人調望遠鏡的順序：
          `headAim` 轉向玩家看的方向（按下那一刻解出來、存著），`tubePan` 在那個方向上慢慢左右掃，
          `tubeTilt` 把鏡筒抬向天空。三個寫的是三個不同的 transform —— 同一個 group 同時被轉向又被
          抬起，抬起的軸就會跟著轉向一起歪掉。 */}
      <group position={[0, TELESCOPE_YOKE_Y, 0]} ref={anim.ref('headAim')}>
      <group ref={anim.ref('tubePan')}>
      <group rotation={[TUBE_REST_TILT, 0, 0]} ref={anim.ref('tubeTilt')}>
        <mesh position={[0, TUBE_LENGTH / 2, 0]} castShadow>
          <cylinderGeometry args={[TUBE_R_TOP, TUBE_R_BOTTOM, TUBE_LENGTH, 12]} />
          <meshStandardMaterial color="#F59E0B" metalness={0.5} roughness={0.3} />
        </mesh>
        {/*
          兩道銅箍。

          改版前這兩道箍的半徑是填的（`0.132 - (y - 0.22) * 0.055`），而鏡筒是一根**錐管**，
          所以兩個數字對不上：下面那道 0.132/0.138 跟鏡筒表面在同一個半徑上，兩個曲面幾乎共面 ——
          鏡頭一拉遠就整圈閃爍（z-fighting）；上面那道算出來是 0.099/0.105，**比鏡筒還細**，整道
          箍埋在管子裡完全看不見。一個閃、一個不見，正好是「面閃爍」跟「缺面」各一。

          現在兩道箍的上下半徑都是從鏡筒自己的錐度取樣再加一個固定的 BAND_STANDOFF，所以不管
          鏡筒的錐度怎麼改，箍永遠比它外面 1.2 公分 —— 不會共面，也不會消失。
        */}
        {TUBE_BANDS.map((band) => (
          <mesh key={`band-${band.y}`} position={[0, band.y, 0]} castShadow>
            <cylinderGeometry args={[band.rTop, band.rBottom, BAND_HEIGHT, 12]} />
            <meshStandardMaterial color={OUT_METAL_DARK} metalness={0.65} roughness={0.3} />
          </mesh>
        ))}
        {/* 目鏡。鏡筒的近端 —— 沒有它，這根管子兩頭都是開的，看不出來要從哪裡看。 */}
        <mesh position={[0, -0.09, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.07, 0.16, 10]} />
          <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.35} />
        </mesh>
        {/* 尋星鏡，架在主鏡筒側上方。 */}
        <mesh position={[0.135, 0.62, 0]} rotation={[0, 0, 0.06]} castShadow>
          <cylinderGeometry args={[0.035, 0.04, 0.42, 8]} />
          <meshStandardMaterial color={OUT_METAL} metalness={0.55} roughness={0.35} />
        </mesh>
        {/* 物鏡端的鏡圈 */}
        <mesh position={[0, 1.08, 0]} castShadow>
          <cylinderGeometry args={[0.115, 0.115, 0.04, 12]} />
          <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.3} />
        </mesh>
        {anim.active && <LensGlint level={anim.level} />}
      </group>
      </group>
      {/* 看到星星的那一下：物鏡前方冒出幾顆小星光。掛在 `headAim` 裡（不跟著掃、不跟著抬），
          所以永遠出現在鏡筒指著的那一側、比物鏡再高一點的地方。 */}
      {anim.since != null && (
        <ObjectBurst
          key={anim.since}
          since={anim.since}
          at={[0, 1.2, 0.38]}
          shape="spark"
          count={4}
          rise={0.35}
          spread={0.3}
          over={0.9}
          delay={0.5}
          stagger={0.14}
          size={0.07}
          color="#FDE68A"
          emissive="#FDE047"
        />
      )}
      </group>
    </group>
  );
}

function BirdhouseModel({ scale, item, instanceId }: FurnitureModelProps) {
  const birdIdleRef = useRef<THREE.Group>(null);
  /*
   * 看看小鳥 is a row in constants/objectAnimations.ts: the bird comes out to the hole, bobs, and
   * goes back in. What is left here is the bird's OWN life — a peek out every few seconds whether
   * or not anyone is there — and it writes a different group (`birdIdle`, above the three part
   * groups), so the peek and the reaction can never fight over one transform. It also stands down
   * while the bird is out for the player: `anim.level()` is the reaction's own signal.
   */
  const anim = useObjectAnimation(instanceId, item);

  useOutdoorAnimation(anim.root, ({ time: t }) => {
    const g = birdIdleRef.current;
    if (!g) return;
    const cycle = (t % 5) / 5;
    const peek = cycle < 0.18 ? Math.sin((cycle / 0.18) * Math.PI) : 0;
    g.position.z = peek * 0.06 * (1 - anim.level());
  }, { radius: 1.8, cullDistance: 30 });

  return (
    <group ref={anim.root} scale={scale}>
      {/* 地樁盤。改版前柱子是直接從草地長出來的。
          顏色從 OUT_STONE_DARK（#64748b，一個藍灰）換成深木色：這件商品從商店縮圖到 3D 都是
          「木頭 ＋ 紅屋頂」兩個色系，腳下那一圈藍灰是整件東西上唯一一塊不屬於它的顏色，在草地上
          反而變成最搶眼的地方 —— 看起來像鳥屋腳邊有一灘藍色的水。 */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.20, 0.24, 0.08, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 柱子 */}
      <mesh position={[0, 0.60, 0]} castShadow>
        <cylinderGeometry args={[0.042, 0.055, 1.10, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* 兩根斜撐，從柱子撐住上面的平台。鳥屋是「掛在柱子上」還是「架在柱子上」，差別就在這裡：
          沒有斜撐，那個盒子看起來是黏上去的。 */}
      {[-1, 1].map((s) => (
        <mesh key={`strut-${s}`} position={[s * 0.115, 0.90, 0]} rotation={[0, 0, s * -0.42]} castShadow>
          <boxGeometry args={[0.042, 0.34, 0.042]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.9} />
        </mesh>
      ))}
      {/* 底板。屋身站在它上面，四周留出一圈邊 —— 那圈邊就是小鳥的落腳處。 */}
      <mesh position={[0, 1.005, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.05, 0.62]} />
        <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
      </mesh>
      {/* 屋身 */}
      <mesh position={[0, 1.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.55, 0.40, 0.50]} />
        <meshStandardMaterial color={OUT_WOOD_LIGHT} roughness={0.85} />
      </mesh>
      {/*
        雙斜面屋頂，取代改版前那一顆四角錐。

        錐體做屋頂只有一個好處（一個 mesh），代價是它沒有屋脊、沒有出簷、四面一樣，
        遠看是一頂帽子。兩片斜板有屋脊也有屋簷，而屋簷正好蓋在入口洞上方 —— 那是鳥屋
        看起來像「給鳥住的房子」而不是「一個有洞的木盒」的關鍵。

        角度是算出來的：板子 z 向 0.40 寬、傾 0.62 弧度，攤平之後蓋住 0.40·cos(0.62)=0.325 的
        深度、升高 0.40·sin(0.62)=0.232。屋脊在 y=1.62、屋簷落在 y=1.388，屋身頂面是 1.42，
        所以屋簷確實壓在牆上而不是浮著。
      */}
      {/*
        屋脊沿著 **z**（前後）走，所以正面看到的是三角形的山牆 —— 商店縮圖上的鳥屋就是一個
        紅色三角屋頂底下一個圓洞，而改版前屋脊是沿著 x 的，從正面（也就是有洞的那一面）看過去
        只有一片平的紅色長方形，山牆躲在側面。一個屋頂的方向決定了它從哪一面看起來像屋頂。

        轉向之後出簷仍在：屋頂在 z 向伸到 ±0.36，屋身只有 0.25，洞口上方多出 11 公分的簷。
        板子往哪邊倒的符號要跟著換 —— 繞 z 正轉會把 +x 那端抬起來，所以外傾是負的。
      */}
      {[-1, 1].map((s) => (
        <mesh key={`roof-${s}`} position={[s * 0.1625, 1.504, 0]} rotation={[0, 0, -s * 0.62]} castShadow receiveShadow>
          <boxGeometry args={[0.40, 0.045, 0.72]} />
          <meshStandardMaterial color="#c9584d" roughness={0.75} />
        </mesh>
      ))}
      {/* 屋脊壓條，蓋住兩片板子在頂上的接縫。 */}
      <mesh position={[0, 1.635, 0]} castShadow>
        <boxGeometry args={[0.075, 0.055, 0.76]} />
        <meshStandardMaterial color="#a3453c" roughness={0.8} />
      </mesh>
      {/* 入口洞，以及框住它的一圈木邊。 */}
      <mesh position={[0, 1.22, 0.26]}>
        <circleGeometry args={[0.09, 12]} />
        <meshStandardMaterial color={OUT_CHARRED} />
      </mesh>
      <mesh position={[0, 1.22, 0.256]} castShadow>
        <torusGeometry args={[0.108, 0.022, 5, 12]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
      </mesh>
      {/* 洞口下面的棲木。小到只有兩公分粗，但它是「這是給鳥用的」這件事說得最清楚的一根。 */}
      <mesh position={[0, 1.085, 0.295]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.15, 6]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* 住在裡面的小鳥。靜止時整顆在屋身裡（z 0.15，前牆在 0.25），被叫出來時探到洞口（0.28）。
          四層 group：最外層是位置，`birdIdle` 是牠自己每五秒探一次頭，`birdOut`/`birdUp` 是被玩家
          叫出來，`birdBob` 是出來之後好奇地點頭。四個寫的是四個不同的 transform。 */}
      <group position={[0, 1.2, 0.15]}>
        <group ref={birdIdleRef}>
          <group ref={anim.ref('birdOut')}>
            <group ref={anim.ref('birdUp')}>
              <group ref={anim.ref('birdBob')}>
                <mesh castShadow>
                  <sphereGeometry args={[0.09, 10, 10]} />
                  <meshStandardMaterial color="#38BDF8" roughness={0.6} />
                </mesh>
                <mesh position={[0, 0.03, 0.08]}>
                  <coneGeometry args={[0.03, 0.08, 6]} />
                  <meshStandardMaterial color="#F97316" />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
      {/* 小鳥探出來時飄出的兩三根羽毛。 */}
      {anim.since != null && (
        <ObjectBurst
          key={anim.since}
          since={anim.since}
          at={[0, 1.32, 0.32]}
          shape="feather"
          count={3}
          rise={0.45}
          spread={0.32}
          over={1.1}
          delay={0.15}
          stagger={0.12}
          size={0.09}
          color="#e0f2fe"
        />
      )}
    </group>
  );
}

/**
 * Where the well's water stands, in the model's own frame.
 *
 * Below the top of the upper stone course (0.55) on purpose, so the inside of the shaft shows as a
 * band of wet stone above the water and the well reads as a hole in the ground rather than a
 * painted lid. The coin lands here and the ripples spread from here — they are the same height.
 */
const WELL_WATER_Y = 0.47;

function WishingWellModel({ scale, item, instanceId }: FurnitureModelProps) {
  const bucketSwayRef = useRef<THREE.Group>(null);
  const waterMatRef = useRef<THREE.MeshStandardMaterial>(null);
  /*
   * 許願 is a row in constants/objectAnimations.ts: the windlass turns, the bucket dips, a coin
   * arcs in from the player's side, and the water answers. What stays here is the well's own life
   * — the bucket swinging a little on its rope — on the shared culled loop, writing `bucketSway`,
   * which is the group ABOVE the `bucket` part so the swing and the dip never share a transform.
   *
   * THE WATER. The remodel that split the shaft into two stone courses dropped the water disc the
   * old model had, and closed the shaft with the upper course's own flat stone cap — while the
   * comment on the rim still said it was a ring 「so it would not cover the water」, and the 許願
   * timeline still threw the coin to y 0.5 and spread its ripples at y 0.585. So a wish dropped the
   * coin INTO solid stone (it vanished 5 cm under the lid) and rippled a grey disc. The shaft is
   * open again and the water is back at WELL_WATER_Y, which both of those now aim at. Its faint
   * shimmer rides this same culled loop, so a well off-screen costs nothing.
   */
  const anim = useObjectAnimation(instanceId, item);

  useOutdoorAnimation(anim.root, ({ time: t }) => {
    if (bucketSwayRef.current) bucketSwayRef.current.rotation.z = Math.sin(t * 0.9) * 0.08;
    if (waterMatRef.current) waterMatRef.current.emissiveIntensity = 0.28 + Math.sin(t * 1.6) * 0.08;
  }, { radius: 1.8, cullDistance: 34 });

  return (
    <group ref={anim.root} scale={scale}>
      {/*
        井身分成兩層砌石，上面再壓一圈井緣。改版前這裡是一根圓柱 —— 一根同色的圓柱沒有辦法
        讀成「石頭砌的」，因為石造的辨識點就是「一層一層」跟「頂上壓著的那圈」。
        兩層之間刻意重疊（0..0.30 與 0.27..0.55），不重疊的話兩個面會共平面。
      */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.645, 0.68, 0.30, 12]} />
        <meshStandardMaterial color={OUT_STONE} roughness={0.95} />
      </mesh>
      {/* 上層砌石是一圈「開口」的石壁（openEnded），雙面材質讓井壁內側也畫得出來 —— 關起來的話，
          頂上那片石蓋就是整口井的「水面」，硬幣會直接掉進石頭裡。 */}
      <mesh position={[0, 0.41, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.62, 0.648, 0.28, 12, 1, true]} />
        {/* shadowSide 維持單面物件的預設（背面投影）：雙面材質預設兩面都寫進陰影貼圖，外牆會自己
            遮自己，畫成一片細斜紋（shadow acne）。 */}
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.95} side={THREE.DoubleSide} shadowSide={THREE.BackSide} />
      </mesh>
      {/* 井水。不透明，所以不會跟島上其他半透明的東西搶排序；比井口低 8 公分。
          半徑 0.59 是量過的：井壁是 12 邊形，這個高度的外接半徑約 0.628，邊的中點（內切半徑）只有
          0.628 × cos 15° ≈ 0.607。水面比這個大，圓邊就會從每一面石牆的中間穿出來，畫成一條條藍線。 */}
      <mesh position={[0, WELL_WATER_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.59, 24]} />
        <meshStandardMaterial
          ref={waterMatRef}
          color="#2f8fb8"
          emissive="#0c6a94"
          emissiveIntensity={0.28}
          roughness={0.15}
          metalness={0.1}
        />
      </mesh>
      {/* 井緣。環而不是圓盤 —— 圓盤會把水面蓋掉。 */}
      <mesh position={[0, 0.575, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.60, 0.065, 6, 14]} />
        <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.9} />
      </mesh>
      {/* 青苔。這件商品的說明第一句就是「爬滿青苔的石造許願井」，而改版前模型上一點苔都沒有。
          三塊壓扁的綠色貼在石面上，是最便宜的兌現方式。 */}
      {([[0.9, 0.20], [2.8, 0.36], [4.6, 0.14]] as [number, number][]).map(([a, y], i) => (
        <mesh
          key={`moss-${i}`}
          position={[Math.cos(a) * 0.645, y, Math.sin(a) * 0.645]}
          rotation={[0, -a, 0]}
          scale={[0.28, 1, 1]}
        >
          <sphereGeometry args={[0.15 + i * 0.02, 7, 5]} />
          <meshStandardMaterial color={i === 1 ? OUT_LEAF_DARK : '#5b8f3a'} roughness={1} />
        </mesh>
      ))}
      {/* 井邊掉的一顆石頭。不規則的東西讓整座井看起來是砌出來的而不是印出來的。 */}
      <mesh position={[0.72, 0.09, -0.34]} rotation={[0.4, 1.1, 0.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.13, 0]} />
        <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.95} />
      </mesh>
      {/* 立柱 */}
      <mesh position={[-0.5, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 1.0, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      <mesh position={[0.5, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 1.0, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* 兩根斜撐，從井緣頂住立柱。 */}
      {[-1, 1].map((s) => (
        <mesh key={`stay-${s}`} position={[s * 0.585, 0.80, 0]} rotation={[0, 0, s * 0.30]} castShadow>
          <boxGeometry args={[0.05, 0.42, 0.05]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.9} />
        </mesh>
      ))}
      {/* 兩柱之間的橫樑，屋頂壓在它上面。 */}
      <mesh position={[0, 1.46, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 1.12, 8]} />
        <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
      </mesh>
      {/* 捲軸與搖把。繩子本來就從這個高度垂下來，但改版前那裡什麼都沒有 —— 一條繩子憑空
          從屋頂長出來。有了捲軸，那條繩子才有來源，「許願井」也才有可以動手的地方。 */}
      <mesh position={[0, 1.37, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.075, 0.075, 0.86, 10]} />
        <meshStandardMaterial color={OUT_WOOD_LIGHT} roughness={0.85} />
      </mesh>
      {/* 搖把。`crank` 這個部件繞著捲軸的軸心（y 1.37、沿 X）轉，所以 group 放在軸心上、把手往回
          扣掉那段高度 —— 繞著把手自己的中心轉，看起來會像一根被風吹得亂轉的鐵片。 */}
      <group position={[0, 1.37, 0]} ref={anim.ref('crank')}>
        <mesh position={[0.60, -0.07, 0]} rotation={[0, 0, 0.9]} castShadow>
          <boxGeometry args={[0.04, 0.20, 0.04]} />
          <meshStandardMaterial color={OUT_METAL_DARK} metalness={0.5} roughness={0.45} />
        </mesh>
      </group>
      {/*
        雙斜面屋頂，取代改版前那一顆四角錐。理由跟鳥屋一樣：錐體沒有屋脊也沒有屋簷。
        板寬 0.62、傾 0.62 弧度 → 攤平蓋住 0.50 的深度、升高 0.36。屋脊 1.86、屋簷 1.50，
        立柱頂在 1.5，所以屋簷正好落在柱頂上。
      */}
      {[-1, 1].map((s) => (
        <mesh key={`roof-${s}`} position={[0, 1.68, s * 0.252]} rotation={[s * 0.62, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.46, 0.05, 0.62]} />
          <meshStandardMaterial color="#b45309" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 1.87, 0]} castShadow>
        <boxGeometry args={[1.52, 0.06, 0.10]} />
        <meshStandardMaterial color="#8a3d06" roughness={0.85} />
      </mesh>
      {/* 屋頂下的水桶。三層：`bucketSway` 是它自己在繩子上輕輕晃（環境），`rope` 與 `bucket` 是
          許願時放下去再收上來的那一下。繩子的 group 在繩子的**上端**（捲軸下方），所以放長的時候
          只往下長 —— 繩頭一直掛在捲軸上，不會整條滑下來。 */}
      <group position={[0, 1.35, 0]} ref={bucketSwayRef}>
        <group ref={anim.ref('rope')}>
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.5, 4]} />
            <meshStandardMaterial color="#3D2A1C" />
          </mesh>
        </group>
        <group ref={anim.ref('bucket')}>
          <mesh position={[0, -0.5, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.07, 0.15, 10]} />
            <meshStandardMaterial color="#B45309" roughness={0.85} />
          </mesh>
        </group>
      </group>
      {/* 投進井裡的硬幣。掛在 `tossAim` 裡，那個 group 在按下的那一刻被轉向玩家那一側，所以硬幣
          是從玩家合十的雙手那邊飛進井裡的 —— 許願井沒有正面，這一點不能寫死在模型座標裡。 */}
      <group ref={anim.ref('tossAim')}>
        {anim.since != null && (
          <ObjectToss key={anim.since} since={anim.since} from={[0, 0.95, -0.95]} to={[0, WELL_WATER_Y, 0]} arc={0.32} over={0.55} spins={3}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.015, 12]} />
              <meshStandardMaterial color="#FCD34D" emissive="#FBBF24" emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
            </mesh>
          </ObjectToss>
        )}
      </group>
      {/* 硬幣落水之後：井面上盪開兩圈漣漪，再浮起幾顆小星光。都等硬幣落下（0.55 秒）才出來。 */}
      {anim.since != null && (
        <ObjectBurst
          key={`ripple-${anim.since}`}
          since={anim.since}
          at={[0, WELL_WATER_Y + 0.012, 0]}
          shape="ripple"
          count={2}
          spread={0.52}
          over={0.8}
          delay={0.52}
          stagger={0.16}
          color="#e0f2fe"
        />
      )}
      {anim.since != null && (
        <ObjectBurst
          key={`spark-${anim.since}`}
          since={anim.since}
          at={[0, 0.66, 0]}
          shape="spark"
          count={4}
          rise={0.55}
          spread={0.4}
          over={0.9}
          delay={0.72}
          stagger={0.1}
          size={0.07}
          color="#FDE68A"
          emissive="#FDE047"
        />
      )}
    </group>
  );
}

/**
 * 白色柵欄 — one PANEL of picket fence, not a whole enclosure.
 *
 * Shaped to be LINED UP, which is the only way a fence is ever used. The end posts are the
 * model's outer edge in X, so two panels set side by side come to rest post-against-post (the
 * placement system keeps a 4 cm CLEARANCE between colliders and nothing more, see
 * lib/furniturePlacement.ts) and a run reads as one continuous fence instead of a row of gates.
 *
 * Height is chosen against the CHARACTER rather than against a real fence: the pickets top out
 * near 0.84 world units and the posts near 1.02, which on a 2.16-unit chibi is hip-to-waist —
 * high enough to be a boundary, low enough to see the garden over. It also puts the whole panel
 * inside the walking collision band (WALK_BAND_MIN_Y..WALK_BAND_MAX_Y), so a fence that looks
 * like it stops you actually does.
 */
function PicketFenceModel({ scale }: FurnitureModelProps) {
  // Seven pickets on an even 0.26 pitch, which leaves a 0.15 gap between neighbours — the ratio
  // that reads as a picket fence rather than as a solid hoarding.
  const pickets = [-0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78];
  return (
    <group scale={scale}>
      {/* End posts, capped with a little pyramid. The rails run INTO them — a rail ends at
          ±0.95, inside the 0.14-wide post — so no two faces are ever left coplanar. */}
      {[-0.95, 0.95].map((x) => (
        <group key={`post-${x}`} position={[x, 0, 0]}>
          <mesh position={[0, 0.33, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.14, 0.66, 0.14]} />
            <meshStandardMaterial color="#F3EDE1" roughness={0.85} />
          </mesh>
          {/* Sunk 1.5 cm into the post rather than sat on it: a cap resting exactly on the post's
              top face would be two coplanar horizontal surfaces. */}
          <mesh position={[0, 0.71, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[0.12, 0.13, 4]} />
            <meshStandardMaterial color="#C2AE91" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* Two back rails, set 2 cm behind the pickets so the two overlap by 1 cm and read as
          nailed together instead of floating apart.

          A WARM TAN, not another cream. The shop icon draws these rails in #C9A87A precisely
          because they are only ever seen through the 4 px gaps between pickets — a rail the same
          near-white as the picket in front of it makes those gaps vanish, and the fence goes back
          to reading as one flat white slab, which is what the model did. Three tones (picket /
          post / rail) is what the icon promises and what the outdoor palette asks for. */}
      {[0.16, 0.44].map((y) => (
        <mesh key={`rail-${y}`} position={[0, y, -0.02]} castShadow receiveShadow>
          <boxGeometry args={[1.9, 0.075, 0.05]} />
          <meshStandardMaterial color="#c9a87a" roughness={0.9} />
        </mesh>
      ))}
      {/* Pickets, each finished with a point.
          The point is a 4-sided cone, and it takes BOTH of its transforms to land on the picket's
          0.11 × 0.05 section rather than on a shape of its own: the mesh's own π/4 turn puts the
          base square's SIDES on the axes (half-side 0.0778/√2 = 0.055, the picket's half-width),
          and the group around it then squashes Z to 0.4545 so the depth comes out at the picket's
          0.025. The order is the whole trick — squashing first and turning afterwards shears the
          pyramid, and doing neither leaves a diamond inscribed in the picket with its four corners
          showing as shoulders. */}
      {pickets.map((x) => (
        <group key={`picket-${x}`} position={[x, 0, 0.02]}>
          <mesh position={[0, 0.27, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.11, 0.54, 0.05]} />
            <meshStandardMaterial color="#FAF6EE" roughness={0.85} />
          </mesh>
          <group scale={[1, 1, 0.4545]}>
            <mesh position={[0, 0.575, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[0.0778, 0.1, 4]} />
              <meshStandardMaterial color="#FAF6EE" roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/* ============================================================================================
 * 屋外互動家具擴充（2026-09） — 沿用既有的 Furniture Interaction System：每一件只在
 * constants/items.ts 宣告 `interactions`，姿勢語彙不夠的地方在 constants/interactionPostures.ts
 * 加列（recline / hangSeat / toss），這裡的元件完全不知道自己被指定了哪個姿勢。
 * ========================================================================================== */

/** 戶外長椅 —— 四腳、兩側牚、三片座板、兩根靠背立柱撐兩片靠背板。 */
/** 戶外長椅 —— the slats flex a centimetre and the joints creak. Slats only; the frame does not. */
function GardenBenchModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const LEGS: [number, number][] = [[-0.58, -0.19], [-0.58, 0.19], [0.58, -0.19], [0.58, 0.19]];
  return (
    <group ref={anim.root} scale={scale}>
      {LEGS.map(([x, z], i) => (
        <mesh key={`leg-${i}`} position={[x, 0.20, z]} castShadow receiveShadow>
          <boxGeometry args={[0.06, 0.40, 0.06]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* 側牚：把前後腳連成一個框，沒有它四支腳只是四根插在地上的棍子。 */}
      {[-0.19, 0.19].map((z) => (
        <mesh key={`apron-${z}`} position={[0, 0.36, z]} castShadow>
          <boxGeometry args={[1.24, 0.05, 0.05]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* 座板三片 */}
      {[-0.14, 0, 0.14].map((z, i) => (
        <group key={`seat-${i}`} position={[0, 0.42, z]} ref={anim.ref('seat', i)}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.30, 0.045, 0.135]} />
            <meshStandardMaterial color={i === 1 ? OUT_WOOD_LIGHT : OUT_WOOD} roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* 靠背立柱，從後腳延伸上去 */}
      {[-0.58, 0.58].map((x) => (
        <mesh key={`post-${x}`} position={[x, 0.62, -0.19]} rotation={[-0.12, 0, 0]} castShadow>
          <boxGeometry args={[0.06, 0.46, 0.06]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* 靠背板兩片，跟著立柱一起微微後傾 */}
      {[0.60, 0.78].map((y, i) => (
        <mesh key={`back-${i}`} position={[0, y, -0.235 - i * 0.035]} rotation={[-0.30, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.28, 0.11, 0.045]} />
          <meshStandardMaterial color={i === 0 ? OUT_WOOD : OUT_WOOD_LIGHT} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** 樹樁座椅 —— 一段鋸下來的原木，頂面切平，年輪與樹皮各一圈。 */
/** 樹樁座椅 —— a stump does not give; what it does is settle a degree into the turf. */
function TreeStumpSeatModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      <group ref={anim.ref('stump')}>
      <mesh position={[0, 0.23, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.30, 0.335, 0.46, 10]} />
        <meshStandardMaterial color={OUT_WOOD} roughness={0.95} />
      </mesh>
      {/* 樹皮感的深色縱紋，四道貼在側面 */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const r = 0.315;
        return (
          <mesh key={`bark-${i}`} position={[Math.cos(a) * r, 0.23, Math.sin(a) * r]} rotation={[0, -a, 0]} castShadow>
            <boxGeometry args={[0.03, 0.44, 0.05]} />
            <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={1} />
          </mesh>
        );
      })}
      {/* 切平的頂面，年輪用兩圈同心的細環表示 */}
      <mesh position={[0, 0.461, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.30, 12]} />
        <meshStandardMaterial color={OUT_WOOD_LIGHT} roughness={0.8} />
      </mesh>
      {[0.22, 0.12].map((r, i) => (
        <mesh key={`ring-${i}`} position={[0, 0.463, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.008, r, 24]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.8} {...DECAL_DEPTH_BIAS} />
        </mesh>
      ))}
      {/* 一小截露出來的樹根，讓它讀成「鋸下來的」而不是「車出來的桶子」 */}
      <mesh position={[0.22, 0.02, 0.16]} rotation={[0.3, 0.6, 1.1]} castShadow>
        <cylinderGeometry args={[0.03, 0.05, 0.16, 6]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      </group>
    </group>
  );
}

/** 小型露營椅 —— 交叉的折疊腳架、帆布椅面與靠背、兩支扶手杆。 */
/** 小型露營椅 —— canvas: the seat sags under the weight and the back tips with it. */
function CampChairModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    // ×1.45：折疊椅原始比例的座面只有 0.41 世界高，低於髖關節高度會讓「腿伸到地板」的坐姿算出
    // 負值根高（npm run audit:ground 的第 4 部分）。整體放大保持所有比例不變，只是墊高整張椅子。
    <group ref={anim.root} scale={scale * 1.45}>
      {/* 交叉腳架，兩側各一組 X —— 交叉在左右兩側的 y-z 平面裡（繞 x 軸斜），座面正前方是空的。
          改版前兩組 X 放在 z = ±0.24、繞 z 軸斜：也就是擋在座面的**正前方與正後方**，比座面前緣還
          往外凸 3 公分，坐上去的人垂下來的腿一定穿過前面那組 X（`npm run audit:interactions` 量到
          約 3 公分）。圖示（QVersionIcon）與註解一直說的都是「兩側各一組」。 */}
      {[-0.24, 0.24].map((x) => (
        <group key={`frame-${x}`} position={[x, 0, 0]}>
          <mesh position={[0, 0.22, 0]} rotation={[0.62, 0, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, 0.52, 6]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.22, 0]} rotation={[-0.62, 0, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, 0.52, 6]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* 前後兩根橫桿把兩側的 X 架連成一個穩定的箱形：在座面前後緣（z = ±0.20）沿 x 橫跨兩組 X。
          改版前放在 x = ±0.20、同樣沿 x —— 兩根桿子互相重疊在中間，兩端各往外凸出 0.2。 */}
      {[-0.20, 0.20].map((z) => (
        <mesh key={`rail-${z}`} position={[0, 0.30, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.48, 6]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
        </mesh>
      ))}
      {/* 帆布椅面，繃在兩根橫桿之間 */}
      <group position={[0, 0.30, 0]} ref={anim.ref('canvasSeat')}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.02, 0.42]} />
          <meshStandardMaterial color={OUT_CANVAS} roughness={0.95} />
        </mesh>
      </group>
      {/* 靠背：兩根扶手杆延伸上去，帆布繃在中間 */}
      {[-0.20, 0.20].map((x) => (
        <mesh key={`upright-${x}`} position={[x, 0.52, -0.19]} rotation={[-0.28, 0, 0]} castShadow>
          <cylinderGeometry args={[0.017, 0.017, 0.46, 6]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
        </mesh>
      ))}
      <group position={[0, 0.55, -0.30]} rotation={[-0.55, 0, 0]} ref={anim.ref('canvasBack')}>
        <mesh castShadow>
          <boxGeometry args={[0.40, 0.42, 0.018]} />
          <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={0.95} />
        </mesh>
      </group>
    </group>
  );
}

const LOUNGER_WOOD_SEAT_Y = 0.40;

/*
 * 躺椅靠背的共同幾何：一個鉸點、一個仰角，靠背的每一個零件都沿著同一條斜線擺。
 *
 * 靠背在頭那一端（−X：後腳「靠背下方」在 x −0.35，腳踏端在 +X），所以斜線是往 −X 升高的：
 * 沿著靠背的方向是 (−cos θ, sin θ)。一個沿 X 放的長條要躺在這條線上，要繞 Z 轉 **−θ** ——
 * 轉 +θ 會把它的 +X 端抬起來，變成往座面那一側升高。
 *
 * 改版前兩張躺椅的靠背零件全部轉 +θ，而橫板的「位置」卻是照 −X 升高算的：側框朝座位翹起、
 * 從座面上方穿過去，三片橫板每片都斜向另一邊，排出來像散開的百葉窗／一段錯位的階梯；
 * 沙灘躺椅的帆布還把「薄」的那一軸放在 Z 上，轉完變成一片側立的菱形，頭枕浮在半空。
 */
/** 沿靠背往上 `along`、往坐的人那一側 `out` 的一點（局部 XY）。 */
function backrestPoint(hinge: readonly [number, number], tilt: number, along: number, out = 0): [number, number] {
  return [
    hinge[0] - Math.cos(tilt) * along + Math.sin(tilt) * out,
    hinge[1] + Math.sin(tilt) * along + Math.cos(tilt) * out,
  ];
}

/** 木製躺椅的靠背：鉸點在座面後段的橫板高度，仰角 0.95。 */
const LOUNGER_WOOD_HINGE = [-0.10, LOUNGER_WOOD_SEAT_Y + 0.03] as const;
const LOUNGER_WOOD_TILT = 0.95;
/** 靠背側框：0.62 長，從鉸點下方一點一路撐到最上面一片橫板之後，貼在橫板背面。 */
const LOUNGER_WOOD_BACK_RAIL_LEN = 0.62;
const LOUNGER_WOOD_BACK_RAIL_ALONG = 0.29;
/** 橫板厚 0.03、側框高 0.05 —— 兩者半厚相加，側框剛好頂住橫板的背面。 */
const LOUNGER_WOOD_BACK_RAIL_OUT = -(0.03 / 2 + 0.05 / 2);

/** 木製躺椅 —— 兩側木框（座面段＋後仰的靠背段）、七片橫板、四支腳、兩支扶手。 */
/** 木製躺椅 —— a solid wooden frame: it settles a centimetre and creaks, and that is all it does. */
function WoodLoungerModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const [railX, railY] = backrestPoint(
    LOUNGER_WOOD_HINGE, LOUNGER_WOOD_TILT, LOUNGER_WOOD_BACK_RAIL_ALONG, LOUNGER_WOOD_BACK_RAIL_OUT,
  );
  return (
    <group ref={anim.root} scale={scale}>
      <group ref={anim.ref('frame')}>
      {[-0.26, 0.26].map((z) => (
        <group key={`rail-${z}`}>
          {/* 座面段的側框，從椅背底部一路延伸到腳踏端 */}
          <mesh position={[0.18, LOUNGER_WOOD_SEAT_Y, z]} castShadow receiveShadow>
            <boxGeometry args={[1.00, 0.05, 0.045]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
          {/* 靠背段，繞椅背底部的鉸點往後上方翹起（往 −X 升高，所以是 −θ） */}
          <mesh position={[railX, railY, z]} rotation={[0, 0, -LOUNGER_WOOD_TILT]} castShadow receiveShadow>
            <boxGeometry args={[LOUNGER_WOOD_BACK_RAIL_LEN, 0.05, 0.045]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* 座面＋腳踏段的橫板，四片 */}
      {[-0.14, 0.14, 0.42, 0.62].map((x, i) => (
        <mesh key={`seat-slat-${i}`} position={[x, LOUNGER_WOOD_SEAT_Y + 0.03, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.11, 0.03, 0.56]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD : OUT_WOOD_LIGHT} roughness={0.85} />
        </mesh>
      ))}
      {/* 靠背段的橫板，三片，沿同一條斜線、以同一個角度後仰 —— 三片共面，讀成一整片靠背 */}
      {[0.10, 0.28, 0.46].map((d, i) => {
        const [x, y] = backrestPoint(LOUNGER_WOOD_HINGE, LOUNGER_WOOD_TILT, d);
        return (
          <mesh key={`back-slat-${i}`} position={[x, y, 0]} rotation={[0, 0, -LOUNGER_WOOD_TILT]} castShadow receiveShadow>
            <boxGeometry args={[0.11, 0.03, 0.56]} />
            <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD : OUT_WOOD_LIGHT} roughness={0.85} />
          </mesh>
        );
      })}
      {/* 四支腳：前腳短，後腳（靠背下方）略高，撐住鉸點的高度 */}
      {[[-0.35, -0.26], [-0.35, 0.26], [0.62, -0.26], [0.62, 0.26]].map(([x, z], i) => (
        <mesh key={`leg-${i}`} position={[x, LOUNGER_WOOD_SEAT_Y / 2, z]} castShadow>
          <cylinderGeometry args={[0.022, 0.028, LOUNGER_WOOD_SEAT_Y, 8]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
        </mesh>
      ))}
      {/* 扶手 */}
      {[-0.26, 0.26].map((z) => (
        <mesh key={`arm-${z}`} position={[0.05, LOUNGER_WOOD_SEAT_Y + 0.11, z]} castShadow>
          <boxGeometry args={[0.62, 0.045, 0.05]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.85} />
        </mesh>
      ))}
      </group>
    </group>
  );
}

const BEACH_LOUNGER_SEAT_Y = 0.28;

/**
 * 沙灘躺椅的靠背：以側框中點為基準（鉸點在它下端，x ≈ −0.21，正好落在座框後段），仰角 0.85。
 * 帆布、頭枕、斜撐全部從這一點與這個角度推出來 —— 見 backrestPoint 上面那段說明。
 */
const BEACH_LOUNGER_BACK_MID = [-0.40, BEACH_LOUNGER_SEAT_Y + 0.17] as const;
const BEACH_LOUNGER_TILT = 0.85;
/** 側框 0.035 見方、帆布 0.02 厚：帆布中心往坐的人那一側 0.02，兩者重疊 7.5 公釐 —— 繃在框上。 */
const BEACH_LOUNGER_CANVAS_OUT = 0.02;
/** 斜撐落地的那一點：靠背後方的地面。 */
const BEACH_LOUNGER_BRACE_FOOT = [-0.72, 0] as const;

/** 沙灘躺椅 —— 低矮鋁木框、帆布條座面、單支撐架撐起後仰的靠背，跟木製躺椅刻意做出「低矮＋軟面」的差異。 */
/** 沙灘躺椅 —— canvas over a low frame: the seat straps sag and the backrest gives with them. */
function BeachLoungerModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const back = (along: number, out = 0) =>
    backrestPoint(BEACH_LOUNGER_BACK_MID, BEACH_LOUNGER_TILT, along, out);
  const [canvasX, canvasY] = back(0, BEACH_LOUNGER_CANVAS_OUT);
  // 頭枕：靠在帆布正面的上段（帆布半厚 0.01 ＋ 頭枕半厚 0.05）。
  const [pillowX, pillowY] = back(0.18, BEACH_LOUNGER_CANVAS_OUT + 0.01 + 0.05);
  // 斜撐：從靠背後方的地面，撐到帆布背面的中上段。
  const [topX, topY] = back(0.12, BEACH_LOUNGER_CANVAS_OUT - 0.01 - 0.016);
  const braceDX = topX - BEACH_LOUNGER_BRACE_FOOT[0];
  const braceDY = topY - BEACH_LOUNGER_BRACE_FOOT[1];
  return (
    <group ref={anim.root} scale={scale}>
      {[-0.27, 0.27].map((z) => (
        <group key={`frame-${z}`}>
          <mesh position={[0.16, BEACH_LOUNGER_SEAT_Y, z]} castShadow receiveShadow>
            <boxGeometry args={[0.96, 0.035, 0.035]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.7} />
          </mesh>
          <mesh
            position={[BEACH_LOUNGER_BACK_MID[0], BEACH_LOUNGER_BACK_MID[1], z]}
            rotation={[0, 0, -BEACH_LOUNGER_TILT]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.56, 0.035, 0.035]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.7} />
          </mesh>
          {/* 矮腳，貼近地面 */}
          <mesh position={[-0.32, BEACH_LOUNGER_SEAT_Y / 2, z]} castShadow>
            <cylinderGeometry args={[0.018, 0.022, BEACH_LOUNGER_SEAT_Y, 6]} />
            <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.8} />
          </mesh>
          <mesh position={[0.60, BEACH_LOUNGER_SEAT_Y / 2, z]} castShadow>
            <cylinderGeometry args={[0.018, 0.022, BEACH_LOUNGER_SEAT_Y, 6]} />
            <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* 撐住靠背的斜撐（沙灘椅常見的「腳架」），只在中間一支就足夠讀出結構。
          圓柱預設沿 Y，繞 Z 轉 φ 之後的方向是 (−sin φ, cos φ)，所以 φ = atan2(−dx, dy)。 */}
      <mesh
        position={[BEACH_LOUNGER_BRACE_FOOT[0] + braceDX / 2, BEACH_LOUNGER_BRACE_FOOT[1] + braceDY / 2, 0]}
        rotation={[0, 0, Math.atan2(-braceDX, braceDY)]}
        castShadow
      >
        <cylinderGeometry args={[0.016, 0.016, Math.hypot(braceDX, braceDY), 6]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.7} />
      </mesh>
      {/* 帆布條座面，三條並排（不是疊在一起）、兩色交錯 */}
      {[-0.16, 0, 0.16].map((z, i) => (
        <group key={`canvas-seat-${i}`} position={[0.16, BEACH_LOUNGER_SEAT_Y + 0.02, z]} ref={anim.ref('canvas', i)}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.92, 0.02, 0.15]} />
            <meshStandardMaterial color={i % 2 === 0 ? OUT_CANVAS : OUT_CANVAS_DARK} roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* 靠背帆布：沿靠背 0.52、橫跨兩側框 0.50、厚 0.02 —— 薄的那一軸是 Y（貼著斜面的法線），
          不是 Z。 */}
      <group position={[canvasX, canvasY, 0]} rotation={[0, 0, -BEACH_LOUNGER_TILT]} ref={anim.ref('canvasBack')}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.02, 0.50]} />
          <meshStandardMaterial color={OUT_CANVAS} roughness={0.95} />
        </mesh>
      </group>
      {/* 頭枕 */}
      <mesh position={[pillowX, pillowY, 0]} rotation={[0, 0, -BEACH_LOUNGER_TILT]} castShadow>
        <boxGeometry args={[0.16, 0.10, 0.44]} />
        <meshStandardMaterial color="#f5c85c" roughness={0.9} />
      </mesh>
    </group>
  );
}

/**
 * 吊椅的尺寸 —— 局部單位（島上繪製倍率 1.3175）。這一組數字是**從坐在上面的角色量回來**的，
 * 不是隨手放大：
 *
 *   改版前是一顆半徑 0.44（世界 0.58）的封閉蛋殼，吊點 1.95、離立柱 0.40。坐姿角色的頭骨半徑
 *   就有 0.54、頭頂在 2.7 —— 頭整顆高過吊點，四條往中間收的吊繩穿過臉，立柱擦過手臂，身體
 *   卡在蛋殼頂蓋底下。`npm run audit:interactions` 量到手 7 公分、軀幹 6.6 公分、腿 12.8 公分。
 *
 *   ① 座面降到世界 0.62，跟其他椅子一樣高（腳離地一點點），整顆身體才有高度放。
 *   ② 蛋殼去掉頂蓋、做深做寬，變成正面開口的藤編吊籃：身體坐在籃子前緣，背靠著籃壁。
 *   ③ 兩條繩接在籃子兩側、上方用一根撐桿撐開 —— 跟鞦韆一樣，頭在兩條繩中間。
 *   ④ 吊點升到坐姿頭頂以上（世界 2.45），曲臂外伸 0.64（世界 0.84），立柱離開身體。
 *
 * 模型與角色控制器繞同一個點擺動：HANGING_CHAIR_PIVOT_Y × 1.3175 = SUSPENDED_MOTIONS.hangingChair.pivotY。
 */
const HANGING_CHAIR_PIVOT_Y = 1.86;
const HANGING_CHAIR_PIVOT_X = 0.64;
/** 曲臂的高度：立柱頂端橫伸出去，吊鉤從這裡垂到吊點。 */
const HANGING_CHAIR_ARM_Y = 1.97;
/** 撐桿：吊點下方一小段，兩端各拉一條繩到籃子兩側。 */
const HANGING_CHAIR_SPREADER_Y = -0.12;
const HANGING_CHAIR_SPREAD = 0.52;
/**
 * 吊籃本體：一顆去掉頂蓋、正面開口的球（吊點以下的局部座標）。`RIM_THETA` 是頂端開口的邊緣，
 * 籃緣那一圈的高度與半徑都是從球解出來的，繩子接在那一圈的兩側，籃子大小改了繩子自己跟著走。
 */
const HANGING_CHAIR_SHELL_Y = -1.27;
const HANGING_CHAIR_SHELL_R = 0.50;
const HANGING_CHAIR_SHELL_KY = 0.85;
const HANGING_CHAIR_RIM_THETA = Math.PI * 0.32;
const HANGING_CHAIR_RIM_Y = HANGING_CHAIR_SHELL_Y + HANGING_CHAIR_SHELL_R * HANGING_CHAIR_SHELL_KY * Math.cos(HANGING_CHAIR_RIM_THETA);
const HANGING_CHAIR_RIM_R = HANGING_CHAIR_SHELL_R * Math.sin(HANGING_CHAIR_RIM_THETA);
/** 正面開口（three.js 球的 phi：π/2 朝 +Z）。籃壁從 phi = 0.81π 畫 1.38π，剩下正前方 0.62π。 */
const HANGING_CHAIR_PHI_START = Math.PI * 0.81;
const HANGING_CHAIR_PHI_LENGTH = Math.PI * 1.38;
/**
 * 坐墊：一塊頂面平的圓墊（上寬下窄），頂面在吊點下 1.389 —— 世界 (1.86 − 1.389) × 1.3175 = 0.620，
 * 就是目錄的 `surfaceY`；前緣在 z 0.02 + 0.34 = 0.36，世界 0.474，就是 `seatFront`。平頂而不是
 * 壓扁的球，是為了讓「坐在哪個高度、腿從哪條邊垂下去」是模型上真的存在的一個面、一條邊。
 */
const HANGING_CHAIR_CUSHION_TOP = -1.389;
const HANGING_CHAIR_CUSHION_R = 0.34;
const HANGING_CHAIR_CUSHION_H = 0.14;

/**
 * 吊椅 —— C 形立架（獨立站立，不需要掛在真的樹上）＋ 藤編吊籃，繞吊點擺動。
 *
 * 跟鞦韆共用同一套懸吊解算（`suspendedAngle`／`suspendedPhase`），但讀的是自己的
 * `SUSPENDED_MOTIONS.hangingChair`（小得多的 `ride`），所以晃起來明顯比鞦韆溫和。
 */
function HangingChairModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const seatGroupRef = useRef<THREE.Group>(null);
  const timeline = useFurnitureOccupancy(instanceId);

  useOutdoorAnimation(rootRef, ({ position }) => {
    const seat = seatGroupRef.current;
    if (!seat) return;
    sampleWind(position.x, position.z, 0, FURNITURE_WIND);
    const phase = suspendedPhase(timeline.current, performance.now(), FURNITURE_WIND.sway);
    seat.rotation.x = suspendedAngle(SUSPENDED_MOTIONS.hangingChair, phase);
    seat.position.y = HANGING_CHAIR_PIVOT_Y + suspendedSag(SUSPENDED_MOTIONS.hangingChair, phase) / (scale || 1);
  }, { radius: 2.6 });

  const ropeDx = HANGING_CHAIR_SPREAD - HANGING_CHAIR_RIM_R;
  const ropeDy = HANGING_CHAIR_SPREADER_Y - HANGING_CHAIR_RIM_Y;
  const ropeLen = Math.hypot(ropeDx, ropeDy);

  return (
    <group ref={rootRef} scale={scale}>
      {/* 配重底座：立柱腳下一塊圓座，再用一條貼地的木腳伸到吊籃正下方，把重心拉回來。 */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[0.42, 0.46, 0.10, 12]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      <mesh position={[HANGING_CHAIR_PIVOT_X * 0.62, 0.035, 0]} receiveShadow>
        <boxGeometry args={[HANGING_CHAIR_PIVOT_X * 1.1, 0.07, 0.16]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 立柱 */}
      <mesh position={[0, (0.10 + HANGING_CHAIR_ARM_Y) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, HANGING_CHAIR_ARM_Y - 0.10, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
      </mesh>
      {/* 肘：立柱頂端與曲臂的接頭，讓轉角是圓的而不是兩根棍子插在一起。 */}
      <mesh position={[0, HANGING_CHAIR_ARM_Y, 0]} castShadow>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
      </mesh>
      {/* 外伸的曲臂，水平伸到吊籃正上方。 */}
      <mesh position={[(HANGING_CHAIR_PIVOT_X + 0.03) / 2, HANGING_CHAIR_ARM_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, HANGING_CHAIR_PIVOT_X + 0.03, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.85} />
      </mesh>
      {/* 吊鉤：從曲臂垂到吊點。 */}
      <mesh position={[HANGING_CHAIR_PIVOT_X, (HANGING_CHAIR_ARM_Y + HANGING_CHAIR_PIVOT_Y) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, HANGING_CHAIR_ARM_Y - HANGING_CHAIR_PIVOT_Y, 6]} />
        <meshStandardMaterial color={OUT_METAL_DARK} metalness={0.5} roughness={0.4} />
      </mesh>

      {/* 吊點以下：掛環、撐桿、兩條繩、吊籃本體。整組繞 X 軸擺動。 */}
      <group ref={seatGroupRef} position={[HANGING_CHAIR_PIVOT_X, HANGING_CHAIR_PIVOT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.045, 0.014, 6, 10]} />
          <meshStandardMaterial color={OUT_METAL_DARK} metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, HANGING_CHAIR_SPREADER_Y / 2, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.012, -HANGING_CHAIR_SPREADER_Y, 5]} />
          <meshStandardMaterial color={OUT_DRY} roughness={1} />
        </mesh>
        {/* 撐桿 —— 把兩條繩撐到籃子兩側，頭就在兩條繩中間，不會被往中間收的繩子穿過。 */}
        <mesh position={[0, HANGING_CHAIR_SPREADER_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.028, 0.028, HANGING_CHAIR_SPREAD * 2 + 0.06, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.85} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh
            key={`rope-${s}`}
            position={[s * (HANGING_CHAIR_SPREAD + HANGING_CHAIR_RIM_R) / 2, (HANGING_CHAIR_SPREADER_Y + HANGING_CHAIR_RIM_Y) / 2, 0]}
            rotation={[0, 0, -s * Math.atan2(ropeDx, ropeDy)]}
            castShadow
          >
            <cylinderGeometry args={[0.014, 0.014, ropeLen, 5]} />
            <meshStandardMaterial color={OUT_DRY} roughness={1} />
          </mesh>
        ))}
        {/* 籃緣的藤箍，正面開口那一段跳過 —— 跟籃壁的開口是同一個角度。 */}
        <mesh
          position={[0, HANGING_CHAIR_RIM_Y, 0]}
          rotation={[Math.PI / 2, 0, HANGING_CHAIR_PHI_START]}
          castShadow
        >
          <torusGeometry args={[HANGING_CHAIR_RIM_R, 0.026, 5, 16, HANGING_CHAIR_PHI_LENGTH]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.95} />
        </mesh>
        {/*
          藤編吊籃 —— 一顆**去掉頂蓋、正面開口**的球。

          three.js 的 SphereGeometry 在 phi=π/2 面向 +Z，所以從 0.81π 開始畫 1.38π，剩下的 0.62π
          就是正前方的開口；theta 從 RIM_THETA 開始，頂上那一塊就是空的，坐進去的身體從那裡出來。
          雙面材質讓內壁也看得見。
        */}
        <mesh position={[0, HANGING_CHAIR_SHELL_Y, 0]} scale={[1, HANGING_CHAIR_SHELL_KY, 1]} castShadow receiveShadow>
          <sphereGeometry args={[HANGING_CHAIR_SHELL_R, 18, 10, HANGING_CHAIR_PHI_START, HANGING_CHAIR_PHI_LENGTH, HANGING_CHAIR_RIM_THETA, Math.PI - HANGING_CHAIR_RIM_THETA]} />
          <meshStandardMaterial color={OUT_DRY} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        {/* 內襯：同一顆球小一號、深一階，透過開口看進去的那一層。 */}
        <mesh position={[0, HANGING_CHAIR_SHELL_Y, 0]} scale={[1, HANGING_CHAIR_SHELL_KY, 1]}>
          <sphereGeometry args={[HANGING_CHAIR_SHELL_R - 0.035, 18, 9, HANGING_CHAIR_PHI_START, HANGING_CHAIR_PHI_LENGTH, HANGING_CHAIR_RIM_THETA + 0.02, Math.PI - HANGING_CHAIR_RIM_THETA - 0.02]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        {/* 藤條肋，貼在殼外面繞著背側 —— 正面開口那一段跳過。每根的高度只到籃緣。 */}
        {[0, 1, 2, 3].map((i) => {
          const a = Math.PI * (0.95 + (i / 3) * 1.1);
          return (
            <mesh
              key={`rib-${i}`}
              position={[Math.cos(a) * (HANGING_CHAIR_SHELL_R - 0.02), HANGING_CHAIR_SHELL_Y - 0.05, Math.sin(a) * (HANGING_CHAIR_SHELL_R - 0.02)]}
              rotation={[0, -a, 0]}
              castShadow
            >
              <boxGeometry args={[0.02, 0.52, 0.02]} />
              <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
            </mesh>
          );
        })}
        {/* 坐墊。見 HANGING_CHAIR_CUSHION_Y：頂面就是目錄的 surfaceY，前緣就是 seatFront。 */}
        <mesh position={[0, HANGING_CHAIR_CUSHION_TOP - HANGING_CHAIR_CUSHION_H / 2, 0.02]} castShadow receiveShadow>
          <cylinderGeometry args={[HANGING_CHAIR_CUSHION_R, HANGING_CHAIR_CUSHION_R - 0.03, HANGING_CHAIR_CUSHION_H, 16]} />
          <meshStandardMaterial color={OUT_CANVAS} roughness={0.95} />
        </mesh>
        {/* 靠背抱枕，貼著籃子的背壁。 */}
        <mesh position={[0, HANGING_CHAIR_CUSHION_TOP + 0.16, -0.30]} rotation={[-0.30, 0, 0]} scale={[1, 1, 0.42]} castShadow>
          <sphereGeometry args={[0.20, 10, 7]} />
          <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={0.95} />
        </mesh>
        {/* 底端小流蘇，生活感的最後一筆 */}
        {[-0.10, 0.10].map((x) => (
          <mesh key={`tassel-${x}`} position={[x, HANGING_CHAIR_SHELL_Y - HANGING_CHAIR_SHELL_R * HANGING_CHAIR_SHELL_KY - 0.04, 0]} castShadow>
            <coneGeometry args={[0.02, 0.10, 5]} />
            <meshStandardMaterial color={OUT_DRY} roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** 野餐墊 —— 紅白格紋方巾，一角微微掀起，兩顆小石頭壓住另外兩角。 */
/** 野餐墊 —— the cloth presses flat under whoever is on it, and its loose corner keeps flapping. */
function PicnicBlanketModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const CHECKS: [number, number][] = [[-0.53, -0.53], [0, -0.53], [0.53, -0.53], [-0.53, 0], [0.53, 0], [-0.53, 0.53], [0, 0.53], [0.53, 0.53]];
  return (
    <group ref={anim.root} scale={scale}>
      <group ref={anim.ref('cloth')}>
        <mesh position={[0, 0.012, 0]} receiveShadow>
          <boxGeometry args={[1.62, 0.024, 1.62]} />
          <meshStandardMaterial color={OUT_CANVAS} roughness={0.95} />
        </mesh>
      </group>
      {CHECKS.map(([x, z], i) => (
        <mesh key={`check-${i}`} position={[x, 0.024, z]} receiveShadow>
          <boxGeometry args={[0.50, 0.006, 0.50]} />
          <meshStandardMaterial color={OUT_FLOWER_RED} roughness={0.95} {...DECAL_DEPTH_BIAS} />
        </mesh>
      ))}
      {/* 掀起的一角 */}
      <group position={[0.70, 0.05, -0.70]} rotation={[0.35, 0.78, 0.1]} ref={anim.ref('corner')}>
        <mesh castShadow>
          <boxGeometry args={[0.30, 0.02, 0.30]} />
          <meshStandardMaterial color={OUT_CANVAS} roughness={0.95} />
        </mesh>
      </group>
      {/* 邊緣流蘇，四邊各一長條 —— 比毯子本身窄一截，四條也互相縮短，避免在四個角落疊在一起 */}
      {[[0, 0.83], [0, -0.83], [0.83, 0], [-0.83, 0]].map(([x, z], i) => (
        <mesh key={`fringe-${i}`} position={[x, 0.016, z]} rotation={[0, i < 2 ? 0 : Math.PI / 2, 0]}>
          <boxGeometry args={[1.48, 0.01, 0.05]} />
          <meshStandardMaterial color={OUT_DRY} roughness={1} {...DECAL_DEPTH_BIAS} />
        </mesh>
      ))}
      {/* 壓角的小石頭 */}
      {[[-0.72, 0.72], [0.72, -0.05]].map(([x, z], i) => (
        <mesh key={`weight-${i}`} position={[x, 0.05, z]} rotation={[0.4, i, 0.2]} castShadow>
          <dodecahedronGeometry args={[0.045, 0]} />
          <meshStandardMaterial color={OUT_STONE} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 野餐籃 —— 藤編籃身、掀開一半的籃蓋露出格紋布、拱形提把。
 *
 * MIGRATED off its own `useFrame`. It used to own the four lines every reacting object owned —
 * read the clock, subtract the trigger, pick a target, lerp toward it — and that lerp is exactly
 * what the new system cannot afford: it integrates, so a basket culled mid-open would have been
 * frozen half-way rather than un-asked. The lid's travel, its hold and its easing are now the
 * `picnic-basket` row, and the model is geometry again.
 */
/** 籃口：籃身頂面的高度與半徑（籃身是 0.30 → 0.256 的圓台，高 0.35）。 */
const PICNIC_BASKET_RIM_Y = 0.35;
const PICNIC_BASKET_RIM_R = 0.30;
/** 提把跨在籃口前半的哪一條弦上。 */
const PICNIC_BASKET_HANDLE_Z = 0.12;
function PicnicBasketModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* 籃身。底部必須落在 y = 0 —— 那是這件商品放下去時貼著地面的那個平面。

          改版前籃身是「中心 0.19、高 0.32」，也就是從 0.03 到 0.35：整個籃子懸空 0.03 個局部
          單位，在島上的 BUILDING 縮放（1.3175）下是 40mm，草地與籃底之間看得到一條縫和一道
          對不上的影子。修法是把籃身往下**長**到地面（高度 0.32 → 0.35，中心 0.175），而不是
          把整個模型往下移：籃口、蓋子、提把與兩道編紋的高度全部維持原樣，只有原本不存在的
          那 3 公分籃底被補上，錐度也照原本每單位 0.125 的收縮率算，所以編紋仍然凸出籃身。 */}
      <mesh position={[0, 0.175, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.30, 0.256, 0.35, 12]} />
        <meshStandardMaterial color={OUT_DRY} roughness={0.95} />
      </mesh>
      {/* 編紋。三圈平均切在 0.32 高的籃身上、而且環管有 1.2 公分粗，等於把籃子切成三塊等高的
          圓環 —— 商店縮圖上那是一個**有籃身**的提籃加兩道編線，模型讀出來卻是三顆疊起來的甜甜圈。
          改成兩圈、更細、往內縮到跟籃身齊平：它們是紋路，不是結構。 */}
      {[0.13, 0.245].map((y, i) => (
        <mesh key={`weave-${i}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.278 + i * 0.004, 0.0055, 4, 14]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* 露出來的格紋布 */}
      <mesh position={[0, 0.34, 0.05]} castShadow>
        <boxGeometry args={[0.44, 0.08, 0.30]} />
        <meshStandardMaterial color={OUT_CANVAS} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.36, 0.10]} castShadow>
        <boxGeometry args={[0.30, 0.05, 0.14]} />
        <meshStandardMaterial color={OUT_FLOWER_RED} roughness={0.95} />
      </mesh>
      {/* 籃蓋，鉸接在後緣，掀開一個角度 */}
      {/* The lid's REST is the half-lifted pose the model has always drawn (and the pose every
          audit measures it in); opening it lays it right back. */}
      <group ref={anim.ref('lid')} position={[0, 0.36, -0.14]} rotation={[-0.9, 0, 0]}>
        <mesh position={[0, 0, 0.14]} castShadow>
          <boxGeometry args={[0.48, 0.05, 0.28]} />
          <meshStandardMaterial color={OUT_DRY} roughness={0.95} />
        </mesh>
      </group>
      {/* 拱形提把 —— 兩腳落在籃口上、跨過籃子的一道拱。

          半圓環（torus 只畫 π）預設就是站在 XY 平面上、往 +Y 拱起的形狀，本身就是提把該有的
          樣子。改版前多轉了 [π/2, 0, 0]，把它放倒成一個水平的半圈，還浮在籃口上方 27 公分 ——
          商店圖上跨在籃子上的那道提把，模型上是一根懸空的橫條。
          現在不轉，兩腳正好落在籃口（y 0.35、半徑 0.30）上；放在籃子的前半（z +0.12），
          跟往後掀的籃蓋（前緣最遠到 z ≈ 0.03）錯開，蓋子打開時不會撞到提把。 */}
      <mesh
        position={[0, PICNIC_BASKET_RIM_Y, PICNIC_BASKET_HANDLE_Z]}
        castShadow
      >
        <torusGeometry args={[Math.sqrt(PICNIC_BASKET_RIM_R ** 2 - PICNIC_BASKET_HANDLE_Z ** 2), 0.022, 6, 12, Math.PI]} />
        <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
      </mesh>
      {/* 兩個金屬扣 */}
      {[-0.18, 0.18].map((x) => (
        <mesh key={`clasp-${x}`} position={[x, 0.34, 0.24]} castShadow>
          <boxGeometry args={[0.06, 0.05, 0.02]} />
          <meshStandardMaterial color={OUT_METAL} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** 小型野餐桌 —— 兩組 A 字腳架、一根連接橫樑、五片桌板。純裝飾，不宣告互動。 */
function PicnicTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/*
        兩端各一組 A 字腳。

        傾角從 0.30 加到 0.52 弧度，而且每一組多一根橫檔把兩隻腳綁在一起 —— 這件商品的名字、
        描述（「簡單的 A 字腳野餐桌」）與商店縮圖上那兩個明顯的交叉支架講的都是同一件事，而
        改版前 0.30 的斜度配上沒有橫檔的四隻腳，從正面看就是四根直立的木棒：桌子還是桌子，
        但「A 字腳」這個賣點在島上不存在。

        A 字腳的橫檔是它跟一張普通四腳桌唯一的差別，一組兩個 mesh，很便宜。
      */}
      {[-0.62, 0.62].map((x) => (
        <group key={`frame-${x}`}>
          {[-1, 1].map((s) => (
            <mesh key={`leg-${s}`} position={[x, 0.28, s * 0.20]} rotation={[s * 0.52, 0, 0]} castShadow>
              <boxGeometry args={[0.07, 0.66, 0.06]} />
              <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
            </mesh>
          ))}
          {/* A 字腳的那一橫 */}
          <mesh position={[x, 0.24, 0]} castShadow>
            <boxGeometry args={[0.05, 0.05, 0.44]} />
            <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* 底部連接橫樑 */}
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[1.30, 0.06, 0.06]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* 桌板五片 */}
      {[-0.34, -0.17, 0, 0.17, 0.34].map((z, i) => (
        <mesh key={`top-${i}`} position={[0, 0.57, z]} castShadow receiveShadow>
          <boxGeometry args={[1.40, 0.05, 0.15]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD : OUT_WOOD_LIGHT} roughness={0.85} />
        </mesh>
      ))}
      {/* 兩端封邊。頂面刻意壓在桌板頂面之下（0.58 對 0.595），跟木製平台同一個理由：
          兩個朝上的面完全共平面會 z-fight，封邊本來就該讀成「蓋在桌板下緣」而不是齊平。 */}
      {[-0.70, 0.70].map((x) => (
        <mesh key={`fascia-${x}`} position={[x, 0.545, 0]} castShadow>
          <boxGeometry args={[0.04, 0.07, 0.90]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/*
 * 小型觀景平台的尺寸 —— 模型自己的局部單位（畫出來再乘 BUILDING 的 1.3175）。
 *
 * 全部寫成具名常數、其他尺寸從它們推出來，是這件模型這一輪修掉的錯誤的反面：改版前每個零件的
 * 高度都是各自打的數字，於是欄杆群組放在 `DECK_Y + 0.16 = 0.71`、而木板頂面在 0.6825 —— 三面
 * 欄杆整組懸空 2.75 公分；階梯三階的 y 從 0.10 往上加、z 從 −1.05 往外減 —— 最高的一階離平台
 * 最遠，整段樓梯是反的，最低一階還浮在地面上 5 公分。任何一個高度改了，另一個不會跟著動。
 */
/** 支柱頂＝底板底。 */
const DECK_Y = 0.55;
/** 底板的半邊長與厚度。 */
const DECK_HALF = 0.95;
const SUBDECK_H = 0.10;
const SUBDECK_TOP = DECK_Y + SUBDECK_H;
/** 木板：中心高、厚度 —— 木板頂面就是玩家站的那一層（lib/furniturePlacement.ts 量出來的）。 */
const PLANK_Y = DECK_Y + 0.11;
const PLANK_H = 0.045;
const DECK_TOP = PLANK_Y + PLANK_H / 2;
/**
 * 支柱往地面以下延伸到哪裡。平台放在斜坡上時是坐在「底下最高的那塊地」上
 * （lib/placementSurfaces.ts 的 resolvePlacementY），低的那一側要靠支柱一路插到地裡，
 * 不然四支腳會停在半空中。跟木製平台的角柱是同一個道理。
 */
const DECK_POST_FOOT = -0.45;
/** 欄杆：立在底板上（穿過木板那一層），柱頂維持改版前的 1.31，橫杆也維持原本的絕對高度。 */
const RAIL_TOP = 1.31;
const RAIL_BARS_Y = [0.95, 1.26] as const;
const SIDE_RAIL_X = 0.92;
const BACK_RAIL_Z = 0.85;
/**
 * 階梯：四個等高的踏步（三塊踏板＋最後一步踏上甲板），從甲板的開放面（−Z）往外、往下。
 * 最高的那一塊貼著甲板邊，最低的那一塊最遠 —— 走上去是往平台走，不是往外走。
 */
const STAIR_RISERS = 4;
const STAIR_RISE = DECK_TOP / STAIR_RISERS;
const STAIR_RUN = 0.28;
const STAIR_WIDTH = 0.72;
const STAIR_TREAD_H = 0.05;
/** 最高一塊踏板的內緣就是甲板前緣，其他依序往外。 */
const stairTreadZ = (i: number) => -DECK_HALF - (STAIR_RISERS - 2 - i + 0.5) * STAIR_RUN;
/**
 * 兩側斜梁：沿著踏板前緣那條線（每一階的鼻端都在同一條斜線上，斜率就是 RISE/RUN），
 * 上緣比踏步高 2 公分，下端插進地面、上端頂到甲板前緣 —— 所以每一塊踏板兩端都架在梁上，
 * 整段樓梯既落地、也接在平台上。
 */
const STRINGER_T = 0.05;
const STRINGER_H = 0.14;
const STRINGER_SLOPE = Math.atan2(STAIR_RISE, STAIR_RUN);
const STRINGER_TOP_Z = -DECK_HALF;
const STRINGER_BOTTOM_Z = stairTreadZ(0) - STAIR_RUN / 2 - 0.07;
/** 踏板前緣連成的那條線在 z 處的高度。 */
const stairNosingY = (z: number) => STAIR_RISE + (z - (stairTreadZ(0) - STAIR_RUN / 2)) * Math.tan(STRINGER_SLOPE);
const stringerCenterY = (z: number) =>
  stairNosingY(z) + 0.02 - STRINGER_H / 2 / Math.cos(STRINGER_SLOPE);

/**
 * 小型觀景平台 —— 抬高的木棧板、三面欄杆、一段通往開放面的木階梯。
 *
 * 眺望風景. Nothing on a viewing deck opens, so the reaction is the thing the deck is FOR: a pennant
 * on the rail that snaps up in the wind while somebody is standing there looking at the view. It is
 * hung off an EXISTING rail post rather than on a new pole of its own, because a new post on a piece
 * the player walks around on is a new thing to walk into.
 *
 * 碰撞完全是量出來的（lib/furniturePlacement.ts 的 STAND_RULES）：木板與三塊踏板是「地」，
 * 欄杆、支柱、斜梁與甲板側面是「牆」—— 從地面上來只能走階梯，站在甲板上會被欄杆擋住。
 * 這裡沒有任何一個碰撞數字，改了模型碰撞就跟著改。
 */
function ViewingDeckModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const postH = DECK_Y - DECK_POST_FOOT;
  const railH = RAIL_TOP - SUBDECK_TOP;
  const stringerLen = (STRINGER_TOP_Z - STRINGER_BOTTOM_Z) / Math.cos(STRINGER_SLOPE);
  const stringerZ = (STRINGER_TOP_Z + STRINGER_BOTTOM_Z) / 2;
  return (
    <group ref={anim.root} scale={scale}>
      {/* The pennant, on the top of the back rail's +X post. */}
      <group position={[0.75, RAIL_TOP - 0.01, BACK_RAIL_Z]} ref={anim.ref('pennant')}>
        <mesh position={[-0.14, -0.045, 0]} castShadow>
          <boxGeometry args={[0.26, 0.13, 0.012]} />
          <meshStandardMaterial color={OUT_FLOWER_RED} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* 四支支柱，從地面以下一路撐到底板 */}
      {[[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]].map(([x, z], i) => (
        <mesh key={`post-${i}`} position={[x, DECK_POST_FOOT + postH / 2, z]} castShadow>
          <cylinderGeometry args={[0.07, 0.09, postH, 8]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
        </mesh>
      ))}
      {/* 棧板 */}
      <mesh position={[0, DECK_Y + SUBDECK_H / 2, 0]} receiveShadow>
        <boxGeometry args={[DECK_HALF * 2, SUBDECK_H, DECK_HALF * 2]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {[-0.72, -0.24, 0.24, 0.72].map((z, i) => (
        <mesh key={`plank-${i}`} position={[0, PLANK_Y, z]} castShadow receiveShadow>
          <boxGeometry args={[1.86, PLANK_H, 0.42]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD_LIGHT : OUT_WOOD} roughness={0.9} />
        </mesh>
      ))}
      {/* 三面欄杆（正面朝 -Z 開放，留給眺望與階梯的方向），每面兩根柱＋兩道橫杆。
          欄杆立在底板上、穿過木板那一層，所以柱腳一定踩在甲板上（改版前整組浮在木板上方 2.75 公分）。
          兩側欄杆收在底板邊緣以內，柱子不會有一半懸在甲板外。
          背面橫杆的兩端各插進側面橫杆 5 公釐 —— 接在一起、但不共平面。 */}
      {[
        { at: [0, BACK_RAIL_Z] as const, barLen: (SIDE_RAIL_X - 0.02 + 0.005) * 2, postAt: 0.75, rotY: 0 },
        { at: [-SIDE_RAIL_X, 0] as const, barLen: 1.82, postAt: 0.75, rotY: Math.PI / 2 },
        { at: [SIDE_RAIL_X, 0] as const, barLen: 1.82, postAt: 0.75, rotY: Math.PI / 2 },
      ].map((side, i) => (
        <group key={`rail-${i}`} position={[side.at[0], SUBDECK_TOP, side.at[1]]} rotation={[0, side.rotY, 0]}>
          {[-side.postAt, side.postAt].map((p, j) => (
            <mesh key={`rp-${j}`} position={[p, railH / 2, 0]} castShadow>
              <boxGeometry args={[0.05, railH, 0.05]} />
              <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
            </mesh>
          ))}
          {RAIL_BARS_Y.map((y, j) => (
            <mesh key={`rr-${j}`} position={[0, y - SUBDECK_TOP, 0]} castShadow>
              <boxGeometry args={[side.barLen, 0.04, 0.04]} />
              <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 通往開放面的木階梯：三塊踏板，一階比一階高、一階比一階靠近甲板 */}
      {Array.from({ length: STAIR_RISERS - 1 }, (_, i) => (
        <mesh
          key={`step-${i}`}
          position={[0, (i + 1) * STAIR_RISE - STAIR_TREAD_H / 2, stairTreadZ(i)]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[STAIR_WIDTH, STAIR_TREAD_H, STAIR_RUN]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD : OUT_WOOD_LIGHT} roughness={0.9} />
        </mesh>
      ))}
      {/* 兩側斜梁 */}
      {[-1, 1].map((s) => (
        <mesh
          key={`stringer-${s}`}
          position={[s * (STAIR_WIDTH / 2 + STRINGER_T / 2), stringerCenterY(stringerZ), stringerZ]}
          rotation={[-STRINGER_SLOPE, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[STRINGER_T, STRINGER_H, stringerLen]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 帳篷 —— 四面金字塔帳身、掀開的門簾、地墊、四條營繩與營釘。
 *
 * 目前的互動系統只有家具自己座標系裡的一個**靜態**錨點，沒有「角色消失進入內部」的狀態機
 * （跟鞦韆選擇做成「推」而不是「坐」是同一個限制）。所以「進入帳篷」做成：`lie` 姿勢的錨點
 * 放在門口的地墊上、`facing: 0`、`forward` 落在墊子上 —— 身體會從錨點往 -Z（帳篷內部方向）
 * 躺進去，頭朝帳篷、腳朝門口，視覺上讀作「在帳篷裡休息」，但不做遮擋。
 */
function TentModel({ scale, item, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const anim = useObjectAnimation(instanceId, item, rootRef);
  const flapRig = useWindRig(rootRef, { flap: { ...WIND_NODES.cloth, rest: [0, 0, 0.55] as const, lag: 0.05 } }, { seed: instanceId, radius: 1.8 });

  return (
    <group ref={rootRef} scale={scale}>
      {/* 帳身 —— its group sits on the ground, so 'body' squashes the cone downward as somebody
          settles inside rather than shrinking it away from the pegs. */}
      <group ref={anim.ref('body')}>
        <mesh position={[0, 0.425, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
          <coneGeometry args={[0.62, 0.85, 4]} />
          <meshStandardMaterial color={OUT_CANVAS} roughness={0.9} />
        </mesh>
      </group>
      {/* 帳裙 —— 帳身與地面接觸的一圈加深色，讀出「布垂到地上」而不是插進土裡 */}
      <mesh position={[0, 0.03, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.66, 0.07, 4]} />
        <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={0.95} />
      </mesh>
      {/* 門口的暗色開口 */}
      <mesh position={[0, 0.24, 0.40]} rotation={[0, 0, 0]}>
        <coneGeometry args={[0.20, 0.46, 3]} />
        <meshStandardMaterial color={OUT_CHARRED} roughness={1} />
      </mesh>
      {/* 掀開的門簾，掛在門口一側，隨風輕輕擺動。
          `flapPull` is a SECOND group outside the wind rig's, because the two are different
          things laid on the same cloth: the wind rig owns the idle sway, this owns the pull as
          somebody goes in. Nesting them keeps either free to change without the other. */}
      <group ref={anim.ref('flapPull')} position={[0.20, 0.46, 0.38]}>
        <group ref={flapRig.ref('flap')}>
          <mesh position={[0, -0.16, 0.02]} castShadow>
            <boxGeometry args={[0.28, 0.42, 0.02]} />
            <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
      {/* 門前的睡墊 —— `lie` 互動的錨點就落在這裡 */}
      <mesh position={[0, 0.025, 0.62]} receiveShadow>
        <boxGeometry args={[0.62, 0.05, 0.46]} />
        <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={0.9} />
      </mesh>
      {/* 四條營繩與營釘 */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const anchorR = 0.92;
        const wallR = 0.50;
        const ax = Math.cos(a) * anchorR;
        const az = Math.sin(a) * anchorR;
        const wx = Math.cos(a) * wallR;
        const wz = Math.sin(a) * wallR;
        const midX = (ax + wx) / 2;
        const midZ = (az + wz) / 2;
        const len = Math.hypot(ax - wx, az - wz, 0.30);
        return (
          <group key={`guy-${i}`}>
            <mesh
              position={[midX, 0.20, midZ]}
              rotation={[0, -Math.atan2(az - wz, ax - wx), Math.PI / 2 - Math.atan2(0.30, Math.hypot(ax - wx, az - wz))]}
              castShadow
            >
              <cylinderGeometry args={[0.008, 0.008, len, 4]} />
              <meshStandardMaterial color={OUT_DRY} roughness={1} />
            </mesh>
            <mesh position={[ax, 0.015, az]} rotation={[0.2, 0, 0.15]} castShadow>
              <coneGeometry args={[0.02, 0.09, 4]} />
              <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** 木柴堆 —— 六根交錯疊放的原木、一把插著的斧頭、地上散落的木屑。純裝飾。 */
function FirewoodStackModel({ scale }: FurnitureModelProps) {
  /*
    [x, y, z, 繞 y 的偏角]。三層，一層比一層短 —— 商店縮圖畫的是一疊**看得出層數**的柴，而
    改版前這裡的六根木頭偏角從 -0.30 排到 0.62，加上一二層同高，遠看只是一堆散落的圓木。

    交錯（描述裡的「交錯疊起」）留著，但幅度收到 ±0.12 以內：交錯是「這疊柴是手堆的」，
    亂到看不出層就變成「這堆柴倒了」。
  */
  const LOGS: [number, number, number, number][] = [
    [0.00, 0.075, 0.02, 0.05], [0.00, 0.075, -0.17, -0.07], [0.00, 0.075, 0.20, 0.09],
    [0.00, 0.205, -0.09, -0.11], [0.00, 0.205, 0.10, 0.12], [0.00, 0.335, 0.01, -0.04],
  ];
  return (
    <group scale={scale}>
      {LOGS.map(([x, y, z, rotY], i) => (
        <mesh key={`log-${i}`} position={[x, y, z]} rotation={[0, rotY, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[0.075, 0.08, 0.62, 8]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD : OUT_WOOD_DARK} roughness={0.95} />
        </mesh>
      ))}
      {/* 木頭斷面，深色一圈讀出「鋸過的」 */}
      {[[-0.31, 0.075], [0.31, 0.075]].map(([x, y], i) => (
        <mesh key={`endcap-${i}`} position={[x, y, 0]} rotation={[0, 0, Math.PI / 2]}>
          <circleGeometry args={[0.078, 8]} />
          <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={1} {...DECAL_DEPTH_BIAS} />
        </mesh>
      ))}
      {/*
        斧頭，斜插在最上面那根柴上。

        商店縮圖把斧頭畫得跟整堆柴一樣醒目 —— 一支黃銅色的斧刃架在木柴上，那是「這堆柴是有人
        要用的」的整句話。改版前模型上的斧刃是一顆 0.11×0.09×0.025 的灰色小方塊，在島上的縮放
        下不到兩公分厚，遠看只剩一根光禿禿的木棒。

        現在斧刃是**兩塊**：靠柄的斧背與外張的斧刃，加起來寬一倍、而且有一道從背到刃的收窄，
        所以側面也看得出是斧頭而不是一塊方鐵。柄改成淺色，跟身下的深色柴堆分開。
      */}
      <mesh position={[0.05, 0.46, 0.02]} rotation={[0, 0, -0.22]} castShadow>
        <cylinderGeometry args={[0.018, 0.020, 0.42, 6]} />
        <meshStandardMaterial color={OUT_WOOD_LIGHT} roughness={0.85} />
      </mesh>
      <mesh position={[0.145, 0.635, 0.02]} rotation={[0, 0, -0.22]} castShadow>
        <boxGeometry args={[0.10, 0.13, 0.055]} />
        <meshStandardMaterial color={OUT_METAL_DARK} metalness={0.55} roughness={0.45} />
      </mesh>
      {/* 斧刃：比斧背高、比斧背薄的一片，亮一階的金屬色。斧背深、斧刃亮，側面看得出這是一支
          有厚度的斧頭而不是一塊插在木頭上的鐵片。 */}
      <mesh position={[0.235, 0.655, 0.02]} rotation={[0, 0, -0.22]} castShadow>
        <boxGeometry args={[0.085, 0.185, 0.036]} />
        <meshStandardMaterial color={OUT_METAL} metalness={0.6} roughness={0.3} />
      </mesh>
      {/* 散落的木屑 */}
      {[[0.30, -0.28], [-0.34, 0.20], [0.02, -0.36]].map(([x, z], i) => (
        <mesh key={`chip-${i}`} position={[x, 0.012, z]} rotation={[0, i, 0]} receiveShadow>
          <boxGeometry args={[0.05, 0.02, 0.03]} />
          <meshStandardMaterial color={OUT_DRY} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** 飛盤 —— 平躺在地上的圓盤，一圈凸緣與兩道色帶。 */
/**
 * 飛盤 —— 丟飛盤: it actually leaves.
 *
 * Three nested groups, one per axis of the flight, all driven off the same trigger by the
 * `frisbee` row: forward, up, and spinning. Nested rather than combined because that is what puts
 * the spin in the DISC'S own frame — spinning the outermost group would have carried the flight
 * path round with it and thrown the disc in a circle.
 *
 * `pulse` means the flight is a function of the clock and nothing accumulates, so a frisbee
 * thrown just before the player walks away is back on the grass when they turn round rather than
 * still travelling, or stuck in a field somewhere with a timer holding a reference to it.
 */
function FrisbeeModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* 飛的方向。這一層只有 yaw，什麼都不平移 —— 它必須跟 flyForward 分開，因為 three.js
          一個節點的 position 是在**父層**的座標系裡套用的：把 yaw 跟 z 位移放在同一個 group 上，
          盤子只會原地轉，然後照舊往同一個方向飛。玩家從哪一邊丟、朝哪個方向丟，決定的是這一層
          （constants/objectAnimations.ts 的 `launch`）。 */}
      <group ref={anim.ref('flyAim')}>
      <group ref={anim.ref('flyForward')}>
      <group ref={anim.ref('flyRise')}>
      <group ref={anim.ref('flySpin')} rotation={[0, 0, 0.06]}>
      <mesh position={[0, 0.018, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.15, 0.028, 16]} />
        <meshStandardMaterial color={OUT_WATER} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.030, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.155, 0.012, 6, 16]} />
        <meshStandardMaterial color={OUT_BLOSSOM_WHITE} roughness={0.7} />
      </mesh>
      {/* 盤面的淺藍內圈與白色環線。商店縮圖上的飛盤是**兩階藍加一圈白線**；改版前這裡是一圈
          黃色，於是卡片上的藍飛盤買回來變成藍黃雙色的靶。顏色是這件小東西唯一的辨識特徵。 */}
      <mesh position={[0, 0.033, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.115, 16]} />
        <meshStandardMaterial color={OUT_WATER_LIGHT} roughness={0.6} {...DECAL_DEPTH_BIAS} />
      </mesh>
      <mesh position={[0, 0.034, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.062, 0.082, 16]} />
        <meshStandardMaterial color={OUT_BLOSSOM_WHITE} roughness={0.7} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/* 盤底 —— 內凹的握持唇緣，以及被自己遮住的那一圈陰影面。

          飛盤躺在草地上時玩家看到的是頂面，但它是 objectAnimations 裡會**飛起來**的一件
          （constants/objectAnimations.ts 的 flySpin/flyRise/flyForward）—— 飛到眼睛高度時
          看到的是底面，而改版前那裡什麼都沒有：一個 0.028 厚的圓柱底，純平、跟頂面同色。
          真正的飛盤靠這一圈內凹的唇緣被認出來，所以這兩塊不是裝飾，是它翻過來那一面的全部。 */}
      <mesh position={[0, 0.010, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.138, 0.016, 6, 16]} />
        <meshStandardMaterial color={OUT_WATER_DARK} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.128, 16]} />
        <meshStandardMaterial color={OUT_WATER_DARK} roughness={0.7} />
      </mesh>
      </group>
      </group>
      </group>
      </group>
    </group>
  );
}

/** 沙灘球 —— 一顆白球加四道色瓣，經典沙灘球配色。 */
/** 沙灘球 —— 丟沙灘球: thrown out, one bounce, and rolling to a stop. Same three groups as 飛盤. */
function BeachBallModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  const wedgeColors = [OUT_FLOWER_RED, OUT_FLOWER_YELLOW, OUT_WATER, OUT_FLOWER_PURPLE];
  return (
    // 抬高必須在 scale 底下，不能跟 scale 掛在同一個 group 上。
    //
    // three.js 一個節點的 position 是在它自己的 scale **之後**才套用的，所以
    // `<group scale={scale} position={[0, 0.22, 0]}>` 的意思是「半徑乘上 scale，但抬高不乘」。
    // 島上 BUILDING 的 scale 是 0.85 × 1.55 = 1.3175，於是半徑變成 0.292 而抬高還是 0.22 ——
    // 球有 72mm 陷在草地裡。這不是把數字調一調的問題：抬高與半徑必須在同一個座標系裡，
    // 否則每換一次縮放就要重調一次。
    //
    // 抬高也刻意用最大的那個半徑（彩瓣的 0.222，不是白球的 0.22），球才真的切在地面上。
    <group ref={anim.root} scale={scale}>
      <group position={[0, 0.222, 0]}>
      {/* 滾／飛的方向。跟飛盤同一個做法：這一層只轉 yaw，位移在它底下 —— 兩者放在同一個 group
          上會變成球原地自轉、照舊往同一個方向滾。玩家站在球的哪一邊、朝哪個方向踢，決定的是
          這一層（constants/objectAnimations.ts 的 `launch`）。 */}
      <group ref={anim.ref('flyAim')}>
      <group ref={anim.ref('flyForward')}>
      <group ref={anim.ref('flyRise')}>
      {/* roll 在抬高之後，所以球是繞自己的球心滾，不是繞地面上的接觸點。 */}
      <group ref={anim.ref('roll')}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.22, 14, 10]} />
        <meshStandardMaterial color={OUT_BLOSSOM_WHITE} roughness={0.5} />
      </mesh>
      {/*
        四道色瓣，每一道 45°，跟四道白瓣一比一交錯 —— 也就是縮圖上那顆分成幾大塊顏色的球。

        改版前每一瓣只有 22.5°（`(Math.PI * 2) / 16`），四瓣加起來覆蓋 90°，剩下 270° 全是白的：
        島上放下去是一顆白球上有四條細色帶，商店卡上卻是一顆四色球。沙灘球是靠**色塊**被認出來
        的東西，色塊佔比就是它的辨識度。
      */}
      {wedgeColors.map((c, i) => (
        <mesh key={`wedge-${i}`} rotation={[0, (i / wedgeColors.length) * Math.PI * 2, 0]}>
          <sphereGeometry args={[0.222, 10, 10, 0, Math.PI / 4]} />
          <meshStandardMaterial color={c} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.222, 0]}>
        <sphereGeometry args={[0.02, 6, 6]} />
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.6} />
      </mesh>
      </group>
      </group>
      </group>
      </group>
      </group>
    </group>
  );
}

/* ============================================================================================
 * 屋外植物擴充（2026-09） —— 沿用椰子樹已經建立好的模式：useWindRig 一個共用 registry entry，
 * `seed: instanceId` 讓每一株的相位/幅度/速度自動不同，模型元件本身完全不知道自己被種了幾株。
 * 每一種樹在 Silhouette／樹冠形狀／樹幹結構／葉片輪廓 至少一項跟其他樹明顯不同 —— 不靠 Scale
 * 或換色製造差異。
 * ========================================================================================== */

/** 闊葉樹 —— 兩段樹幹、渾圓飽滿的葉簇疊成的樹冠，兩根外露枝條撐出「有骨架」的讀感。 */
const BROADLEAF_TRUNK = [
  { len: 0.34, tilt: 0.020, rBottom: 0.10, rTop: 0.080 },
  { len: 0.30, tilt: 0.048, rBottom: 0.080, rTop: 0.058 },
] as const;
const BROADLEAF_RIG = {
  trunk0: { ...WIND_NODES.trunk, rest: [0, 0, BROADLEAF_TRUNK[0].tilt] as const },
  trunk1: { ...WIND_NODES.trunk, rest: [0, 0, BROADLEAF_TRUNK[1].tilt] as const, lag: 0.06 },
  crown: { ...WIND_NODES.branch, rest: [0, 0, 0] as const, lag: 0.16 },
  leaf0: { ...WIND_NODES.leaf, lag: 0.24 },
  leaf1: { ...WIND_NODES.leaf, lag: 0.27 },
  leaf2: { ...WIND_NODES.leaf, lag: 0.30 },
  leaf3: { ...WIND_NODES.leaf, lag: 0.33 },
} as const;
type BroadleafRigKey = keyof typeof BROADLEAF_RIG;
/**
 * 冠外的葉簇 —— 掛在主冠外緣，把渾圓的球打散成「一叢一叢的葉子」。
 *
 * 第四簇是放大之後補的：這棵樹現在 3.65 高，玩家會從樹下往上看，而三簇在主冠的一側留下一大
 * 片沒有起伏的球面。第四簇補在 −X/+Z 那個空缺上。
 */
const BROADLEAF_LEAFLETS: readonly (readonly [number, number, number])[] = [
  [0.05, 0.52, 0.20], [-0.28, 0.22, 0.18], [0.12, 0.08, -0.30], [-0.30, 0.46, -0.06],
];

function BroadleafTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<BroadleafRigKey>(rootRef, BROADLEAF_RIG, { seed: instanceId, radius: 2.2 });
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.10, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.10, 0.17, 0.20, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      <group ref={rig.ref('trunk0')} position={[0, 0.20, 0]} rotation={BROADLEAF_RIG.trunk0.rest}>
        <mesh position={[0, BROADLEAF_TRUNK[0].len / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[BROADLEAF_TRUNK[0].rTop, BROADLEAF_TRUNK[0].rBottom, BROADLEAF_TRUNK[0].len, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>
        <group ref={rig.ref('trunk1')} position={[0, BROADLEAF_TRUNK[0].len, 0]} rotation={BROADLEAF_RIG.trunk1.rest}>
          <mesh position={[0, BROADLEAF_TRUNK[1].len / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[BROADLEAF_TRUNK[1].rTop, BROADLEAF_TRUNK[1].rBottom, BROADLEAF_TRUNK[1].len, 8]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
          {[[-0.18, 0.06, 0.28, 0.6], [0.15, -0.10, 0.30, -0.9]].map(([x, y, rotZ, rotX], i) => (
            <mesh key={`stub-${i}`} position={[x, BROADLEAF_TRUNK[1].len * 0.75 + y, 0]} rotation={[rotX, 0, rotZ]} castShadow>
              <cylinderGeometry args={[0.018, 0.028, 0.22, 6]} />
              <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
            </mesh>
          ))}
          <group ref={rig.ref('crown')} position={[0, BROADLEAF_TRUNK[1].len, 0]}>
            {/* 主冠。放大到大型喬木級距（3.65，玩家的 1.7 倍）之後這一塊佔了整個剪影的一半，
                所以它拿最亮的一階 —— 改版前用 OUT_LEAF，對島上草地只有 1.25:1。 */}
            <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
              <sphereGeometry args={[0.42, 10, 8]} />
              <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
            </mesh>
            <mesh position={[0.23, 0.16, 0.10]} castShadow>
              <sphereGeometry args={[0.27, 8, 7]} />
              <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
            </mesh>
            <mesh position={[-0.20, 0.42, -0.14]} castShadow>
              <sphereGeometry args={[0.25, 8, 7]} />
              <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
            </mesh>
            {BROADLEAF_LEAFLETS.map(([x, y, z], i) => (
              <group key={`leaf-${i}`} ref={rig.ref(`leaf${i}` as BroadleafRigKey)} position={[x, y, z]}>
                <mesh castShadow>
                  <sphereGeometry args={[0.16, 7, 6]} />
                  <meshStandardMaterial color={i % 2 === 0 ? OUT_LEAF_LIGHT : OUT_LEAF} roughness={0.9} />
                </mesh>
              </group>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

/** 小型果樹 —— 較矮、樹冠比闊葉樹稀疏，掛著幾顆對比色的果實。 */
const FRUIT_TREE_RIG = {
  trunk0: { ...WIND_NODES.trunk, rest: [0, 0, 0.03] as const },
  crown: { ...WIND_NODES.branch, rest: [0, 0, 0] as const, lag: 0.14 },
  leaf0: { ...WIND_NODES.leaf, lag: 0.22 },
  leaf1: { ...WIND_NODES.leaf, lag: 0.25 },
} as const;
type FruitTreeRigKey = keyof typeof FRUIT_TREE_RIG;
/**
 * 果實掛在樹冠上的方向 —— **單位向量**，實際位置由下面的模型把它乘到樹冠表面上。
 *
 * 改版前這裡填的是四組座標，離樹冠球心最遠的一顆只有 0.26，而球半徑是 0.34：四顆果實**全部
 * 埋在樹葉裡面**，一顆都看不到。小型果樹的商店縮圖上最醒目的就是那三顆橘色果子 —— 拿掉它，
 * 卡片上的果樹和旁邊的闊葉樹在島上是同一棵樹。
 *
 * 寫成方向而不是座標，是因為「貼在樹冠表面上」這件事跟樹冠多大是同一個數字；樹冠改了，果實
 * 自己會跟著跑到新的表面上，不會再一次悄悄陷進去。
 */
const FRUIT_DIRS: readonly (readonly [number, number, number])[] = [
  [0.78, 0.10, 0.62], [-0.72, -0.16, 0.68], [0.10, 0.44, -0.89], [-0.52, -0.40, -0.75],
];
/** 樹冠球的半徑與球心高度，果實與葉簇共用。 */
const FRUIT_CROWN_R = 0.34;
const FRUIT_CROWN_Y = 0.22;

function FruitTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<FruitTreeRigKey>(rootRef, FRUIT_TREE_RIG, { seed: instanceId, radius: 1.7 });
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.075, 0.12, 0.16, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      <group ref={rig.ref('trunk0')} position={[0, 0.16, 0]} rotation={FRUIT_TREE_RIG.trunk0.rest}>
        <mesh position={[0, 0.26, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.048, 0.075, 0.52, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>
        <group ref={rig.ref('crown')} position={[0, 0.52, 0]}>
          <mesh position={[0, FRUIT_CROWN_Y, 0]} castShadow receiveShadow>
            <sphereGeometry args={[FRUIT_CROWN_R, 9, 7]} />
            <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
          </mesh>
          <mesh position={[0.16, 0.10, -0.12]} castShadow>
            <sphereGeometry args={[0.20, 7, 6]} />
            <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
          </mesh>
          {[0, 1].map((i) => (
            <group key={`leaf-${i}`} ref={rig.ref(`leaf${i}` as FruitTreeRigKey)} position={[i === 0 ? -0.18 : 0.06, i === 0 ? 0.30 : 0.42, i === 0 ? 0.10 : -0.14]}>
              <mesh castShadow>
                <sphereGeometry args={[0.14, 7, 6]} />
                <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
              </mesh>
            </group>
          ))}
          {/* 果實掛在樹冠表面上：球心 + 方向 × (樹冠半徑 − 果實半徑的一半)，也就是有一半沒入
              葉叢、另一半露在外面 —— 掛在樹上而不是浮在旁邊。 */}
          {FRUIT_DIRS.map((dir, i) => {
            const r = 0.062;
            const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            const d = FRUIT_CROWN_R - r * 0.45;
            return (
              <mesh
                key={`fruit-${i}`}
                position={[
                  (dir[0] / len) * d,
                  FRUIT_CROWN_Y + (dir[1] / len) * d,
                  (dir[2] / len) * d,
                ]}
                castShadow
              >
                <sphereGeometry args={[r, 7, 6]} />
                <meshStandardMaterial color={i % 2 === 0 ? OUT_FRUIT : OUT_FRUIT_DARK} roughness={0.7} />
              </mesh>
            );
          })}
        </group>
      </group>
    </group>
  );
}

/** 熱帶樹（旅人蕉風）—— 短樹幹頂上一整圈扇形大葉片，沒有「一顆球」的樹冠輪廓。 */
const TROPICAL_TREE_LEAVES: readonly (readonly [number, number])[] = [
  [0.0, 0.05], [0.79, -0.10], [1.57, 0.08], [2.36, -0.05], [3.14, 0.10], [3.93, -0.08], [4.71, 0.06], [5.50, -0.06],
];
function makeTropicalRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {
    trunk0: { ...WIND_NODES.trunk, lag: 0 },
  };
  TROPICAL_TREE_LEAVES.forEach((_, i) => { rig[`frond${i}`] = { ...WIND_NODES.frond, lag: 0.18 + i * 0.02 }; });
  return rig;
}
const TROPICAL_TREE_RIG = makeTropicalRig();
type TropicalTreeRigKey = keyof typeof TROPICAL_TREE_RIG;

function TropicalTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<TropicalTreeRigKey>(rootRef, TROPICAL_TREE_RIG, { seed: instanceId, radius: 2.4 });
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.10, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.10, 0.16, 0.20, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      <group ref={rig.ref('trunk0')} position={[0, 0.20, 0]}>
        <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.065, 0.10, 0.84, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.84, 0]} castShadow>
          <sphereGeometry args={[0.10, 8, 6]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
        {TROPICAL_TREE_LEAVES.map(([a, droop], i) => (
          <group key={`frond-${i}`} ref={rig.ref(`frond${i}` as TropicalTreeRigKey)} position={[0, 0.84, 0]}>
            <group rotation={[0, a, 0]}>
              {/* 葉子往**上**張。改版前這一段是 `rotation={[Math.PI / 2 + 0.30, …]}`，也就是把
                  葉子壓到水平線以下 17 度，八片扇葉攤成一把平放的傘 —— 商店縮圖畫的是一叢從樹幹
                  頂端往上撐開的扇葉，那個往上的張角是熱帶樹跟旁邊那棵椰子樹的差別（椰子樹的葉子
                  才是下垂的）。現在傾角改成水平線以上約 20 度，`droop` 仍然逐片微調高低。 */}
              <group rotation={[droop * 0.3, 0, 0.30]}>
                <mesh position={[0, 0.20, 0.38]} rotation={[Math.PI / 2 - 0.36, 0, 0]} scale={[0.30, 1, 1]} castShadow>
                  <capsuleGeometry args={[0.13, 0.62, 3, 8]} />
                  <meshStandardMaterial color={i % 2 === 0 ? OUT_LEAF : OUT_LEAF_LIGHT} roughness={0.85} />
                </mesh>
                <mesh position={[0, 0.20, 0.38]} rotation={[Math.PI / 2 - 0.36, 0, 0]}>
                  <cylinderGeometry args={[0.012, 0.022, 0.60, 5]} />
                  <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
                </mesh>
              </group>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * 低矮觀賞樹 —— 土墩與板根、細幹、修剪成球的樹冠，冠面由六團葉子拼出來。
 *
 * 改版前是三顆球疊在一根圓錐上，主冠用 OUT_LEAF。放大到中小型樹級距（1.94，約玩家的九成高）
 * 之後兩個問題一起浮出來：
 *
 *  1. 主冠是 OUT_LEAF，對島上草地 PLATEAU_INNER_COLOR 只有 1.25:1。整棵樹面積最大的那一塊跟
 *     背景幾乎同亮度，所以它從遠處看是一團會動的草。改成 OUT_LEAF_LIGHT（1.94:1）——
 *     這是 [[project-outdoor-ground-legibility]] 量出來的結論，不是配色偏好。
 *  2. 一顆 10×8 的球在近距離就是一顆球。修剪過的樹冠**仍然是由葉團組成的**，只是外緣齊；
 *     六團半徑不同的葉子讓輪廓上有起伏，但每一團的外緣都落在同一個半徑附近，所以整體還是
 *     讀作「修剪過」——這正是商品描述裡「緊實的樹冠」跟旁邊那些自然灌木的差別。
 *
 * 商品名叫「低矮」，所以它是這一級距裡最矮的一棵，這件事由 constants/outdoorScale.ts 的倍率
 * 決定並由 `npm run audit:outdoor` 的結構階梯檢查看著。
 */
const DWARF_TREE_RIG = {
  crown: { ...WIND_NODES.leaf, bend: 0.05, cross: 0.4, lag: 0.10 },
  /** 外層葉團晚一步，修剪過的樹冠也不該像一顆硬球一起晃。 */
  tuft: { ...WIND_NODES.leaf, bend: 0.04, cross: 0.5, lag: 0.16 },
} as const;
type DwarfTreeRigKey = keyof typeof DWARF_TREE_RIG;

/** 冠心（局部單位）與冠半徑。 */
const DWARF_TREE_CROWN_R = 0.235;

/**
 * 冠面的葉團 —— [x, y, z, 半徑, 色階]。色階 0=亮 1=中 2=暗。
 *
 * 每一團的 `hypot(x,y,z) + 半徑` 都落在 0.30–0.33 之間：外緣對齊（＝修剪過），但中心與半徑
 * 各不相同（＝仍然看得出是葉團拼的）。太陽在 [20, 20, 10]，所以亮階在 +X/+Z/上方。
 */
const DWARF_TREE_LOBES: readonly (readonly [number, number, number, number, 0 | 1 | 2])[] = [
  [0.105, 0.115, 0.085, 0.150, 0],   // 受光側上緣
  [-0.055, 0.150, 0.070, 0.140, 0],  // 頂前
  [0.130, -0.020, -0.090, 0.145, 1], // 右後
  [-0.145, 0.045, -0.060, 0.140, 1], // 左後
  [0.020, -0.135, 0.115, 0.135, 1],  // 前下裙
  [-0.095, -0.120, -0.105, 0.125, 2], // 背光側最底，整棵唯一的深色
];
const DWARF_TREE_TONES = [OUT_LEAF_LIGHT, OUT_LEAF, OUT_LEAF_DARK] as const;

function DwarfTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<DwarfTreeRigKey>(rootRef, DWARF_TREE_RIG, { seed: instanceId, radius: 1.1 });
  return (
    <group ref={rootRef} scale={scale}>
      {/* 土墩 —— 對草地 4.4:1，把樹釘在地上的那一塊。 */}
      <mesh position={[0, 0.055, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.105, 0.145, 0.110, 10]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 板根 —— 土墩與幹之間的一小段錐面。少了它，細幹是直接插進土裡的一根棍子。 */}
      <mesh position={[0, 0.135, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.048, 0.082, 0.070, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.315, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.034, 0.050, 0.300, 8]} />
        <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
      </mesh>
      <group ref={rig.ref('crown')} position={[0, 0.485, 0]}>
        {/* 主冠。面積最大 → 最亮的一階。 */}
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[DWARF_TREE_CROWN_R, 10, 8]} />
          <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.85} />
        </mesh>
        <group ref={rig.ref('tuft')}>
          {DWARF_TREE_LOBES.map(([x, y, z, r, tone], i) => (
            <mesh key={`lobe-${i}`} position={[x, y, z]} castShadow receiveShadow>
              <sphereGeometry args={[r, 8, 6]} />
              <meshStandardMaterial color={DWARF_TREE_TONES[tone]} roughness={0.85} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/** 花樹 —— 外露分岔的枝條、花簇取代大部分葉簇，讀起來是「開花的樹」而不是換色的闊葉樹。 */
const BLOSSOM_TREE_RIG = {
  trunk0: { ...WIND_NODES.trunk, rest: [0, 0, -0.03] as const },
  branchL: { ...WIND_NODES.branch, rest: [0, 0, 0.55] as const, lag: 0.14 },
  branchR: { ...WIND_NODES.branch, rest: [0, 0, -0.50] as const, lag: 0.17 },
  branchC: { ...WIND_NODES.branch, rest: [0, 0, 0.06] as const, lag: 0.12 },
} as const;
type BlossomTreeRigKey = keyof typeof BLOSSOM_TREE_RIG;
const BLOSSOM_PUFFS: readonly (readonly [number, number, number, number])[] = [
  [0.10, 0.02, 0.05, 0], [-0.06, 0.10, -0.04, 1], [0.02, -0.08, 0.08, 0], [-0.10, -0.02, -0.06, 1],
];

function BlossomTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<BlossomTreeRigKey>(rootRef, BLOSSOM_TREE_RIG, { seed: instanceId, radius: 2.0 });
  const branches: [BlossomTreeRigKey, number, number, number][] = [
    ['branchL', 0.36, -0.02, 0.02], ['branchR', 0.34, 0.10, -0.03], ['branchC', 0.30, 0, 0],
  ];
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.14, 0.18, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      <group ref={rig.ref('trunk0')} position={[0, 0.18, 0]} rotation={BLOSSOM_TREE_RIG.trunk0.rest}>
        <mesh position={[0, 0.30, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.06, 0.09, 0.60, 8]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
        {branches.map(([key, len, ox, oz], bi) => (
          <group key={key} ref={rig.ref(key)} position={[0, 0.60, 0]} rotation={BLOSSOM_TREE_RIG[key].rest}>
            <mesh position={[0, len / 2, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.022, 0.045, len, 6]} />
              <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
            </mesh>
            <group position={[ox, len, oz]}>
              <mesh castShadow>
                <sphereGeometry args={[0.15, 8, 6]} />
                <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
              </mesh>
              {BLOSSOM_PUFFS.map(([x, y, z, tone], i) => (
                <mesh key={`puff-${bi}-${i}`} position={[x * 1.4, y * 1.4 + 0.10, z * 1.4]} castShadow>
                  <sphereGeometry args={[0.075, 6, 6]} />
                  <meshStandardMaterial color={tone === 0 ? OUT_BLOSSOM_PINK : OUT_BLOSSOM_WHITE} roughness={0.8} />
                </mesh>
              ))}
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

/** 枯木／漂流木 —— 裸露分岔枝幹，漂白色，不對稱，靜止不動（示範不是每株植物都要動）。 */
function DriftwoodTreeModel({ scale }: FurnitureModelProps) {
  /**
   * [x, y, z, 傾角X, 傾角Z, 長度]。
   *
   * 後兩根是放大到 2.09（跟玩家差不多高）之後補的。四根枝條在原本 1.23 的高度下夠了；到了
   * 玩家的高度，這件東西的整個賣點就是**分岔的剪影**，而四根只在一個平面上岔開 —— 從側面
   * 繞過去看，它是一根光禿禿的柱子。新的兩根往 ±Z 岔出去，讓任何一個水平角度都看得到分岔。
   */
  const BRANCHES: [number, number, number, number, number, number][] = [
    [0, 0.30, 0, 0.10, 0.28, 0.62],
    [0.08, 0.55, -0.02, -0.35, 0.55, 0.40],
    [-0.06, 0.62, 0.03, 0.60, -0.30, 0.34],
    [0.03, 0.78, 0, -0.15, 0.95, 0.26],
    [0.02, 0.46, 0.09, 0.72, 0.12, 0.36],
    [-0.03, 0.70, -0.08, -0.66, -0.22, 0.30],
  ];
  return (
    <group scale={scale}>
      <mesh position={[0, 0.32, 0]} rotation={[0.06, 0, -0.04]} castShadow receiveShadow>
        <cylinderGeometry args={[0.045, 0.11, 0.64, 7]} />
        <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={1} />
      </mesh>
      {/* 枝條。改版前隔一根就用 OUT_DRY（#b08a4a，一個飽和的黃褐）—— 配上幾乎全白的主幹，
          讀起來是「白色的樹幹上長了褐色的樹枝」，而不是一整根被海水漂白的木頭。商店縮圖上的
          漂流木從頭到尾是同一階淡色。現在三階都留在漂白色系裡：亮面／主體／背光面。 */}
      {BRANCHES.map(([x, y, z, tiltX, tiltZ, len], i) => (
        <mesh key={`branch-${i}`} position={[x, y, z]} rotation={[tiltX, 0, tiltZ]} castShadow receiveShadow>
          <cylinderGeometry args={[0.018, 0.04, len, 6]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_CANVAS : '#c9b89a'} roughness={1} />
        </mesh>
      ))}
      {/* 裸露的根，貼地不對稱地伸出兩截 */}
      {[[0.14, 0.03, 0.10, 0.5], [-0.12, 0.02, -0.08, -0.4]].map(([x, y, z, rotY], i) => (
        <mesh key={`root-${i}`} position={[x, y, z]} rotation={[1.3, rotY, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.05, 0.30, 6]} />
          <meshStandardMaterial color={OUT_CANVAS_DARK} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** 灌木型小樹（海岸風）—— 樹形永遠往一側偏，樹冠扁而寬，讀起來是「常年迎風」。 */
const COASTAL_RIG = {
  trunk0: { ...WIND_NODES.trunk, rest: [0, 0, 0.16] as const, bend: 0.03 },
  crown: { ...WIND_NODES.branch, rest: [0, 0, 0.10] as const, bend: 0.07, lag: 0.14 },
} as const;
type CoastalRigKey = keyof typeof COASTAL_RIG;

function CoastalShrubTreeModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<CoastalRigKey>(rootRef, COASTAL_RIG, { seed: instanceId, radius: 1.7 });
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.075, 0.11, 0.14, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 迎風側的支撐根。樹幹往 +X 傾，所以根往 −X 撐 —— 這是「被風吹歪但沒有倒」的那個
          結構理由，少了它，傾斜的樹幹讀起來像模型放歪了。 */}
      <mesh position={[-0.11, 0.055, 0.02]} rotation={[0, 0.35, 1.15]} castShadow receiveShadow>
        <cylinderGeometry args={[0.022, 0.048, 0.24, 6]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.92} />
      </mesh>
      <group ref={rig.ref('trunk0')} position={[0, 0.14, 0]} rotation={COASTAL_RIG.trunk0.rest}>
        <mesh position={[0, 0.19, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.045, 0.075, 0.38, 8]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>
        {/* 兩根外露的枝條，讀出「有骨架」而不是一顆貼著樹幹的葉球 */}
        {[[0.12, 0.30, 0.35], [-0.10, 0.16, -0.25]].map(([x, len, rotZ], i) => (
          <mesh key={`branch-${i}`} position={[x * 0.5, 0.30, 0]} rotation={[0, 0, rotZ]} castShadow>
            <cylinderGeometry args={[0.016, 0.026, len, 6]} />
            <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
          </mesh>
        ))}
        <group ref={rig.ref('crown')} position={[0, 0.38, 0]}>
          {/* 扁而寬：四顆壓扁的橢球沿風向排開，而不是疊成一顆球 */}
          {/* 主葉團，面積最大 → 最亮的一階（改版前是 OUT_LEAF，對草地 1.25:1）。 */}
          <mesh position={[0.20, 0.06, 0]} scale={[1.3, 0.6, 1.1]} castShadow receiveShadow>
            <sphereGeometry args={[0.30, 9, 7]} />
            <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
          </mesh>
          <mesh position={[0.42, 0.10, 0.10]} scale={[1.1, 0.55, 1]} castShadow>
            <sphereGeometry args={[0.22, 8, 6]} />
            <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
          </mesh>
          <mesh position={[0.05, -0.04, -0.14]} scale={[1, 0.5, 0.9]} castShadow>
            <sphereGeometry args={[0.18, 7, 6]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
          <mesh position={[-0.12, 0.02, 0.08]} scale={[1, 0.5, 0.85]} castShadow>
            <sphereGeometry args={[0.14, 7, 6]} />
            <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
          </mesh>
          {/* 迎風面的三團補葉。放大到 2.17（玩家眼睛高度）之後，四團壓扁的橢球之間看得見
              縫，扁樹冠讀成幾片分開的雲；這三團把下風側的缺口補起來，同時讓上緣不再是一條
              光滑的弧 —— 「常年被風吹成一邊倒」靠的是外緣參差，不是整體傾斜。 */}
          <mesh position={[0.33, -0.05, -0.16]} scale={[1.1, 0.5, 0.95]} castShadow>
            <sphereGeometry args={[0.19, 8, 6]} />
            <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
          </mesh>
          <mesh position={[0.14, 0.16, 0.16]} scale={[1.15, 0.5, 1]} castShadow>
            <sphereGeometry args={[0.20, 8, 6]} />
            <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
          </mesh>
          <mesh position={[0.52, 0.02, -0.02]} scale={[1, 0.45, 0.9]} castShadow>
            <sphereGeometry args={[0.145, 7, 6]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** 竹子 —— 四根高度不同的分節竹竿束，頂端稀疏的葉簇，跟其他樹的圓／扇形樹冠都不同。 */
/**
 * [x, z, 高度, 半徑]。
 *
 * 半徑翻了一倍。商店縮圖上的竹竿是 6/44 ≈ 0.14 的粗細比；改版前模型是 0.076/1.55 ≈ 0.05，
 * 也就是縮圖上的三分之一 —— 卡片上四根有份量的竹子，島上是四根幾乎看不見的細線。竹子的
 * 辨識靠的是「有節的粗竿」，竿太細就連節都看不到了。
 */
const BAMBOO_CULMS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1.42, 0.072], [0.32, 0.16, 1.18, 0.060], [-0.30, -0.13, 1.58, 0.066], [0.10, 0.36, 1.30, 0.056],
];
function makeBambooRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {};
  BAMBOO_CULMS.forEach((_, i) => { rig[`culm${i}`] = { ...WIND_NODES.branch, bend: 0.09, lag: 0.08 + i * 0.05 }; });
  return rig;
}
const BAMBOO_RIG = makeBambooRig();
type BambooRigKey = keyof typeof BAMBOO_RIG;

function BambooModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<BambooRigKey>(rootRef, BAMBOO_RIG, { seed: instanceId, radius: 1.6 });
  return (
    <group ref={rootRef} scale={scale}>
      {BAMBOO_CULMS.map(([x, z, h, r], i) => (
        <group key={`culm-${i}`} ref={rig.ref(`culm${i}` as BambooRigKey)} position={[x, 0, z]}>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[r * 0.82, r, h, 7]} />
            <meshStandardMaterial color={i % 2 === 0 ? OUT_LEAF : OUT_LEAF_DARK} roughness={0.7} />
          </mesh>
          {/* 竹節：兩道環，管徑跟著竿子一起加粗，不然節在粗竿上變成一條看不見的線。 */}
          {[0.38, 0.72].map((t, j) => (
            <mesh key={`node-${j}`} position={[0, h * t, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r * (1 - t * 0.18) + 0.008, 0.016, 4, 8]} />
              <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.8} />
            </mesh>
          ))}
          {/* 頂端稀疏葉簇，兩片 */}
          {[0.5, -0.5].map((s, j) => (
            <mesh key={`leaf-${j}`} position={[s * 0.10, h + 0.05, 0]} rotation={[0, 0, s * 0.9]} scale={[0.16, 1, 1]} castShadow>
              <capsuleGeometry args={[0.05, 0.22, 3, 6]} />
              <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------------- 灌木（Medium Layer） */

/**
 * 圓形灌木 —— 一顆修剪過的球冠，架在露出來的短幹與土墩上。
 *
 * ## 改版前為什麼「擺下去看不到」
 *
 * 不是尺寸。量出來 0.74 × 0.66（世界單位，島上縮放 0.85 × 1.55），比旁邊的 開花灌木 0.67 還高
 * 一點 —— 三種灌木裡最高的那一個。真正的原因有三個，而且三個都不是「放大」能修的：
 *
 * 1. **整叢葉子的明度橫跨草地的明度。** 島上草地是 PLATEAU_INNER_COLOR `#4d7c0f`（相對亮度
 *    0.160）。改版前的主球是 OUT_LEAF `#4a8f2e`（0.213），對比只有 **1.25:1**；而那顆
 *    OUT_LEAF_DARK 的葉簇是 `#3f6a2a`（0.117），**比草還暗**，對比同樣是 1.25:1。也就是說這叢
 *    灌木一半比草亮一點、一半比草暗一點，整個輪廓平均起來**就是草的明度** —— 遠看沒有圖與地的
 *    分離。（tmp-shopmatch 的攝影棚地板是 `#7fa54a`，比草地亮得多，所以在那支工具裡它一直讀成
 *    一顆深色的球 —— 工具本身在美化這個 bug。tmp-shrubfield 用真正的草色，才看得出來。）
 *
 * 2. **底下那一圈枝條整根埋在自己的球裡。** 主球半徑 0.26、中心 0.24，所以球在 y=0.06 那個高度
 *    的半徑是 √(0.26² − 0.18²) = 0.188，而枝條的半徑只有 0.09 —— 差了一倍，完全看不到。
 *    「底部與頂部的結構差異」在資料上存在、在畫面上不存在。這是室外資產反覆出現的那個失敗形狀：
 *    細節被埋在自己的父體積裡。
 *
 * 3. **輪廓是一個正圓。** 三顆點綴用的葉簇最多只凸出主球 3–7 公分（各自的球心距 + 半徑減去
 *    0.26），在 0.26 的球上等於沒有凸出 —— 它們只是三塊淡淡的色斑，不是輪廓上的葉層。
 *
 * ## 改成什麼
 *
 * 明度**整體往上搬一階**：面積最大的主冠改用 OUT_LEAF_LIGHT（0.358，對草地 **1.94:1**），
 * OUT_LEAF 退成背光面、OUT_LEAF_DARK 只留在照不到的那一側最底下。三階層次一階不少，但最大的
 * 那一塊現在明確地站在草的上面而不是跟它同一階。
 *
 * 底下再壓一圈 OUT_WOOD_SHADOW 的土墩（`#573818`，對草地 4.4:1）—— 這是整件事最便宜的一招：
 * 深色的底座把物件釘在地面上，遠比把葉子畫亮更能讓人看出「這裡站著一個東西」。熱帶灌木早就是
 * 這樣做的，這裡只是照抄同一個作法。
 *
 * 短幹**露出來** 0.135 局部單位（世界 0.18）：土墩頂 0.065 到冠底 0.20。冠是實心球，冠底就是
 * 球心減半徑，所以這個數字是解出來的，不是填的 —— 冠的大小改了，露出來的長度自己會跟著對。
 *
 * 輪廓交給五個**真的凸出去**的葉層（`LOBES`）：每一個的球心距加自己的半徑都大於主冠半徑，凸出
 * 量列在表上。它們掛在自己的風擺節點 `tuft` 上（lag 比 `body` 大），所以外層葉子會慢半拍跟著
 * 主冠走 —— 是層次，不是一顆剛體。
 *
 * 總高從世界 0.66 長到 0.88，寬從 0.74 到 0.82：長高三分之一，但沒有一段是靠 scale 乘出來的。
 */
const ROUND_SHRUB_RIG = {
  body: { ...WIND_NODES.leaf, bend: 0.06, cross: 0.4, lag: 0.08 },
  /** 外層葉簇，跟在主冠後面。差的這 0.07 秒就是「一叢葉子」跟「一顆球」的差別。 */
  tuft: { ...WIND_NODES.leaf, bend: 0.055, cross: 0.5, lag: 0.15 },
} as const;
type RoundShrubRigKey = keyof typeof ROUND_SHRUB_RIG;

/** 冠心（局部單位）與冠半徑。露出來的幹長、葉層的凸出量都是從這兩個數字算的。 */
const ROUND_SHRUB_CROWN_Y = 0.43;
const ROUND_SHRUB_CROWN_R = 0.25;

/**
 * 葉層 —— [x, y, z, 半徑, 色階]，冠心的局部座標。色階 0=亮 1=中 2=暗。
 *
 * 太陽在 [20, 20, 10]（Three/Scene.tsx），所以 +X／+Z／上方是受光面、−X／−Z／下方是背光面：
 * 亮的葉層擺受光側，那顆唯一的 OUT_LEAF_DARK 擺在背光側的最底下。
 *
 * 每一層的 `hypot(x,y,z) + 半徑` 都必須 > ROUND_SHRUB_CROWN_R，否則它就是又一個埋在主冠裡的
 * 色斑（見上面第 3 點）。凸出量註在每一行後面。
 */
const ROUND_SHRUB_LOBES: readonly (readonly [number, number, number, number, 0 | 1 | 2])[] = [
  [0.122, 0.097, 0.080, 0.150, 0], // +0.075 受光側上緣
  [-0.111, 0.127, -0.045, 0.135, 0], // +0.060 頂冠背側
  [0.043, -0.097, 0.139, 0.145, 1], // +0.070 前下裙
  [-0.141, -0.053, 0.088, 0.140, 1], // +0.065 左下裙
  [-0.068, -0.121, -0.107, 0.130, 2], // +0.055 背光側最底，整叢唯一的深色
];
const ROUND_SHRUB_LOBE_TONES = [OUT_LEAF_LIGHT, OUT_LEAF, OUT_LEAF_DARK] as const;

function RoundShrubModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<RoundShrubRigKey>(rootRef, ROUND_SHRUB_RIG, { seed: instanceId, radius: 0.9 });
  return (
    <group ref={rootRef} scale={scale}>
      {/* 土墩。整件東西對草地對比最高的一塊（4.4:1），也是「有東西站在這裡」的來源。 */}
      <mesh position={[0, 0.0325, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.185, 0.225, 0.065, 10]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 短幹。上端刻意穿進冠裡 0.04，接得住；露在外面的是土墩頂到冠底那一段。 */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.052, 0.075, 0.20, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      <group ref={rig.ref('body')} position={[0, ROUND_SHRUB_CROWN_Y, 0]}>
        {/* 主冠。面積最大的一塊用最亮的一階 —— 這一行就是「看不看得到」本身。 */}
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[ROUND_SHRUB_CROWN_R, 10, 8]} />
          <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
        </mesh>
        <group ref={rig.ref('tuft')}>
          {ROUND_SHRUB_LOBES.map(([x, y, z, r, tone], i) => (
            <mesh key={`lobe-${i}`} position={[x, y, z]} castShadow receiveShadow>
              <sphereGeometry args={[r, 8, 6]} />
              <meshStandardMaterial color={ROUND_SHRUB_LOBE_TONES[tone]} roughness={0.9} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/**
 * 開花灌木 —— 土墩、短幹、兩層葉冠，外圍一圈**有花心與花萼**的花簇。
 *
 * 改版前是兩顆球加五顆純色小球。放大到灌木級距之後那五顆小球的問題變得很明顯：一顆單色的粉紅
 * 球不是花，是黏在灌木上的糖果 —— 沒有花心、沒有連到枝條，也沒有任何東西說明它長在哪裡。
 *
 * 一朵花現在是**兩個 mesh**：一片壓扁的花瓣盤（球壓成 0.45 的厚度，所以有正面而不是一顆球）
 * 加一顆對比色的花心。這是在 Small/Medium 的 mesh 預算下能買到最多辨識度的做法 —— 五瓣各一個
 * mesh 會讓這一件直接衝破 26 的上限（scripts/audit-outdoor-quality.ts），而花心才是「這是花」
 * 的那個訊號。
 *
 * 葉冠的色階與土墩沿用 圓形灌木 的結論（見那裡的長註）：面積最大的一層拿 OUT_LEAF_LIGHT，
 * 深色只留在背光側，底下墊一圈 OUT_WOOD_SHADOW 的土墩把整叢釘在地上。
 */
const FLOWERING_SHRUB_RIG = {
  body: { ...WIND_NODES.leaf, bend: 0.07, lag: 0.10 },
  /** 花簇比葉冠晚一步，才不會整叢像一塊硬殼一起晃。 */
  blooms: { ...WIND_NODES.leaf, bend: 0.09, cross: 0.5, lag: 0.18 },
} as const;
type FloweringShrubRigKey = keyof typeof FLOWERING_SHRUB_RIG;

/** 冠心（局部單位）與冠半徑 —— 花的位置是從這兩個數字解出來的，不是手填的。 */
const FLOWERING_SHRUB_CROWN_Y = 0.30;
const FLOWERING_SHRUB_CROWN_R = 0.235;

/**
 * 花的方位 —— [方位角, 抬角, 花色]。花色 0=粉 1=黃。
 *
 * 位置由方位角與抬角**解在冠面上**（見下面的三角函式），而不是像改版前那樣直接寫 x/y/z。理由是
 * [[project-shop-icon-model-parity]] 記過的那個反覆出現的失敗：細節被埋進自己的母體積裡。冠半徑
 * 一改，手填的座標就全部作廢，而解出來的不會。
 */
const FLOWERING_SHRUB_BLOOMS: readonly (readonly [number, number, 0 | 1])[] = [
  [0.35, 0.42, 0], [2.05, 0.62, 1], [3.30, 0.28, 0], [4.60, 0.70, 1], [5.55, 0.16, 0], [1.25, -0.18, 0],
];

function FloweringShrubModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<FloweringShrubRigKey>(rootRef, FLOWERING_SHRUB_RIG, { seed: instanceId, radius: 0.9 });
  return (
    <group ref={rootRef} scale={scale}>
      {/* 土墩 —— 對草地 4.4:1，整件東西最強的一塊對比。 */}
      <mesh position={[0, 0.030, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.170, 0.210, 0.060, 10]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 短幹。上端埋進冠裡 0.04，露出來的是土墩頂到冠底那一段。 */}
      <mesh position={[0, 0.135, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.048, 0.068, 0.175, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      <group ref={rig.ref('body')} position={[0, FLOWERING_SHRUB_CROWN_Y, 0]}>
        {/* 主冠。面積最大 → 最亮的一階。 */}
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[FLOWERING_SHRUB_CROWN_R, 9, 7]} />
          <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.9} />
        </mesh>
        {/* 受光側的第二層葉，凸出主冠 0.055。 */}
        <mesh position={[0.105, 0.080, 0.095]} castShadow receiveShadow>
          <sphereGeometry args={[0.145, 8, 6]} />
          <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
        </mesh>
        {/* 背光側底部，整叢唯一的深色。 */}
        <mesh position={[-0.100, -0.090, -0.095]} castShadow receiveShadow>
          <sphereGeometry args={[0.125, 8, 6]} />
          <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
        </mesh>
        <group ref={rig.ref('blooms')}>
          {FLOWERING_SHRUB_BLOOMS.map(([az, el, tone], i) => {
            // 坐落在冠面上、再往外推 0.035，所以花瓣盤一定露在葉子外面。
            const r = FLOWERING_SHRUB_CROWN_R + 0.035;
            const x = Math.cos(el) * Math.sin(az) * r;
            const y = Math.sin(el) * r;
            const z = Math.cos(el) * Math.cos(az) * r;
            const petal = tone === 0 ? OUT_BLOSSOM_PINK : OUT_FLOWER_YELLOW;
            const eye = tone === 0 ? OUT_FLOWER_YELLOW : OUT_FLOWER_RED;
            return (
              // 花朝向自己在冠面上的法線，所以每一朵都是「從灌木上長出來」而不是貼上去的。
              <group key={`bloom-${i}`} position={[x, y, z]} rotation={[-el, az, 0]}>
                <mesh scale={[1, 1, 0.45]} castShadow>
                  <sphereGeometry args={[0.062, 7, 6]} />
                  <meshStandardMaterial color={petal} roughness={0.75} />
                </mesh>
                <mesh position={[0, 0, 0.030]} castShadow>
                  <sphereGeometry args={[0.024, 6, 5]} />
                  <meshStandardMaterial color={eye} roughness={0.7} />
                </mesh>
              </group>
            );
          })}
        </group>
      </group>
    </group>
  );
}

/** 熱帶灌木 —— 大片闊葉叢生而非球狀，跟前兩種灌木的球體輪廓明確不同。 */
/**
 * [方位角, 抬角, 葉長]。
 *
 * 抬角改版前是 ±0.1 上下，也就是七片葉子幾乎**平躺**在地上：量出來 1.24 寬、0.33 高，讀成
 * 一灘攤開的綠色。商店縮圖畫的是一叢像龍舌蘭那樣往上放射的尖葉，而「往上撐開」正是這叢熱帶
 * 灌木跟旁邊那三種圓球灌木的差別。
 *
 * 現在每片葉子抬 0.5–0.95 弧度（約 30–55 度），高低交錯，湊成一個張開的碗。角度是**負的**：
 * 葉子擺在自己那一節的 +Z 上，繞 X 正轉會把 +Z 壓下去，所以抬起來是負角。
 */
const TROPICAL_SHRUB_LEAVES: readonly (readonly [number, number, number])[] = [
  [0, -0.62, 0.46], [0.90, -0.86, 0.40], [1.80, -0.54, 0.44], [2.70, -0.95, 0.36],
  [3.60, -0.66, 0.46], [4.50, -0.50, 0.42], [5.40, -0.80, 0.38],
];

/**
 * 內圈的四片新葉 —— [方位角, 抬角, 葉長]，抬得更陡、更短。
 *
 * 放大到 1.31（灌木級距）之後，外圈那七片攤開的葉子中間露出一個空心：從玩家的俯角看下去，
 * 這叢熱帶灌木的中央是一片草地。真實的龍舌蘭類植物中心是**還沒展開的新葉**，所以這一圈刻意
 * 更短更立，把中心填起來，同時給整叢一個「由內往外長」的層次。
 *
 * 它們用 OUT_LEAF_LIGHT —— 新葉本來就比老葉淡，而這也是這件商品的第四個顏色（外圈只有
 * OUT_LEAF／OUT_LEAF_DARK 兩階，加上土墩的 OUT_WOOD_SHADOW 共三色，低於 Large 級距的下限）。
 */
const TROPICAL_SHRUB_INNER: readonly (readonly [number, number, number])[] = [
  [0.45, -1.24, 0.30], [2.25, -1.16, 0.26], [3.95, -1.30, 0.28], [5.05, -1.12, 0.24],
];
function makeTropicalShrubRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {};
  TROPICAL_SHRUB_LEAVES.forEach((_, i) => { rig[`leaf${i}`] = { ...WIND_NODES.leaf, bend: 0.16, lag: 0.14 + i * 0.03 }; });
  return rig;
}
const TROPICAL_SHRUB_RIG = makeTropicalShrubRig();
type TropicalShrubRigKey = keyof typeof TROPICAL_SHRUB_RIG;
function TropicalShrubModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<TropicalShrubRigKey>(rootRef, TROPICAL_SHRUB_RIG, { seed: instanceId, radius: 1.2 });
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[0.10, 0.14, 0.10, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {TROPICAL_SHRUB_LEAVES.map(([a, droop, len], i) => (
        <group key={`leaf-${i}`} ref={rig.ref(`leaf${i}` as TropicalShrubRigKey)} position={[0, 0.10, 0]}>
          <group rotation={[0, a, 0]}>
            <group rotation={[droop, 0, 0.55]}>
              <mesh position={[0, 0, len / 2]} rotation={[Math.PI / 2, 0, 0]} scale={[0.42, 1, 1]} castShadow receiveShadow>
                <capsuleGeometry args={[0.11, len * 0.7, 3, 7]} />
                <meshStandardMaterial color={i % 2 === 0 ? OUT_LEAF : OUT_LEAF_DARK} roughness={0.85} />
              </mesh>
            </group>
          </group>
        </group>
      ))}
      {/* 內圈新葉。刻意不掛 wind rig：中心的新葉是硬挺的，跟著外圈一起晃反而讀成一團軟布。 */}
      {TROPICAL_SHRUB_INNER.map(([a, droop, len], i) => (
        <group key={`inner-${i}`} position={[0, 0.11, 0]} rotation={[0, a, 0]}>
          <group rotation={[droop, 0, 0.35]}>
            <mesh position={[0, 0, len / 2]} rotation={[Math.PI / 2, 0, 0]} scale={[0.38, 1, 1]} castShadow receiveShadow>
              <capsuleGeometry args={[0.085, len * 0.7, 3, 6]} />
              <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/**
 * 不規則自然灌木 —— 土墩、兩根岔開的木莖、五團大小不一的葉簇，外加兩支冒出頭的嫩枝。
 *
 * 改版前是四顆球：三顆葉色不同的球疊在一起，加一顆貼在地上的小球，沒有土墩也沒有莖。在原本
 * 0.62 的世界高度下那還勉強讀成「地上一叢東西」；放大到 1.15（灌木級距）之後，它就是三顆浮在
 * 草地上的綠球 —— 沒有任何東西說明它為什麼長在那裡。
 *
 * 這裡照抄 圓形灌木 在 2026-09-06 可辨識度整理裡驗證過的三件事，因為那三件事是量得出來的：
 *
 *  1. **深色土墩**。OUT_WOOD_SHADOW 對草地是 4.4:1，是整件東西對比最高的一塊，也是「有東西
 *     站在這裡」的來源。比把葉子調亮有效得多。
 *  2. **色階按面積分配，不是按喜好**。面積最大的主葉簇拿 OUT_LEAF_LIGHT（對草地 1.94:1），
 *     OUT_LEAF 退成側面，OUT_LEAF_DARK 只留在照不到太陽的那一團。改版前最大的那顆是 OUT_LEAF
 *     （1.25:1），整叢因此糊進草地。
 *  3. **葉簇要真的凸出主體**，否則只是埋在裡面的色斑。每一團的 `hypot(x,y,z) + 半徑` 都大於
 *     主葉簇半徑，凸出量註在行末。
 *
 * 「不規則」是這件商品跟另外三種灌木的唯一差別，所以兩根木莖刻意不等高也不對稱，葉簇沿著它們
 * 分佈而不是繞著一個中心 —— 修剪過的球體是 圓形灌木 的工作。
 */
const WILD_SHRUB_RIG = {
  clump0: { ...WIND_NODES.leaf, lag: 0.10 },
  clump1: { ...WIND_NODES.leaf, lag: 0.14 },
  clump2: { ...WIND_NODES.leaf, lag: 0.18 },
  sprig: { ...WIND_NODES.grass, bend: 0.20, lag: 0.24 },
} as const;
type WildShrubRigKey = keyof typeof WILD_SHRUB_RIG;

/** 主葉簇的中心與半徑；下面每一團的凸出量都是從這兩個數字算的。 */
const WILD_SHRUB_CORE_Y = 0.25;
const WILD_SHRUB_CORE_R = 0.19;

/** 副葉簇 —— [x, y, z, 半徑, 色階]，主葉簇的局部座標。色階 0=亮 1=中 2=暗。 */
const WILD_SHRUB_CLUMPS: readonly (readonly [number, number, number, number, 0 | 1 | 2])[] = [
  [0.155, 0.075, 0.090, 0.135, 0],   // +0.145 受光側，第二大的一團
  [-0.130, 0.040, 0.115, 0.120, 1],  // +0.106 左前，中階
  [0.045, 0.150, -0.120, 0.110, 1],  // +0.108 頂後，中階
  [-0.105, -0.085, -0.115, 0.100, 2], // +0.083 背光側最底，整叢唯一的深色
];
const WILD_SHRUB_TONES = [OUT_LEAF_LIGHT, OUT_LEAF, OUT_LEAF_DARK] as const;

function WildShrubModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<WildShrubRigKey>(rootRef, WILD_SHRUB_RIG, { seed: instanceId, radius: 0.9 });
  return (
    <group ref={rootRef} scale={scale}>
      {/* 土墩。刻意做成橢圓（scale x 1.15 / z 0.85）而不是正圓 —— 這叢的主題就是沒被修剪過。 */}
      <mesh position={[0, 0.030, 0]} scale={[1.15, 1, 0.85]} receiveShadow castShadow>
        <cylinderGeometry args={[0.165, 0.205, 0.060, 10]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 兩根岔開的木莖。上端都埋進葉簇裡，露出來的只有土墩頂到葉底那一段。 */}
      <mesh position={[-0.035, 0.135, 0.018]} rotation={[0.06, 0, 0.20]} castShadow receiveShadow>
        <cylinderGeometry args={[0.028, 0.042, 0.185, 6]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      <mesh position={[0.058, 0.105, -0.030]} rotation={[-0.10, 0, -0.28]} castShadow receiveShadow>
        <cylinderGeometry args={[0.022, 0.034, 0.145, 6]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>
      <group ref={rig.ref('clump0')} position={[0, WILD_SHRUB_CORE_Y, 0]}>
        {/* 主葉簇。面積最大，所以拿最亮的一階。 */}
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[WILD_SHRUB_CORE_R, 9, 7]} />
          <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.95} />
        </mesh>
        <group ref={rig.ref('clump1')}>
          {WILD_SHRUB_CLUMPS.map(([x, y, z, r, tone], i) => (
            <mesh key={`clump-${i}`} position={[x, y, z]} castShadow receiveShadow>
              <sphereGeometry args={[r, 8, 6]} />
              <meshStandardMaterial color={WILD_SHRUB_TONES[tone]} roughness={0.95} />
            </mesh>
          ))}
        </group>
      </group>
      {/* 兩支冒出葉冠的嫩枝。它們是「沒有人修剪過這叢」最直接的一句話，而且因為伸出輪廓之外，
          在遠處只看得到剪影時仍然分辨得出這一件不是圓形灌木。 */}
      <group ref={rig.ref('sprig')} position={[0, 0.30, 0]}>
        <mesh position={[0.115, 0.125, 0.055]} rotation={[0.12, 0, -0.42]} castShadow>
          <capsuleGeometry args={[0.016, 0.135, 2, 5]} />
          <meshStandardMaterial color={OUT_LEAF} roughness={0.95} />
        </mesh>
        <mesh position={[-0.075, 0.150, -0.070]} rotation={[-0.18, 0, 0.26]} castShadow>
          <capsuleGeometry args={[0.014, 0.115, 2, 5]} />
          <meshStandardMaterial color={OUT_LEAF_LIGHT} roughness={0.95} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------------- 花卉（Low Layer） */

/** 小型花叢 —— 3~5 支不同高度的花莖群聚，花色各自不同。 */
const FLOWER_CLUSTER_STEMS: readonly (readonly [number, number, number, number])[] = [
  [0.00, 0.00, 0.22, 0], [0.07, 0.03, 0.16, 1], [-0.06, -0.02, 0.19, 2], [0.03, -0.06, 0.13, 1], [-0.04, 0.06, 0.15, 0],
];
function makeFlowerClusterRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {};
  FLOWER_CLUSTER_STEMS.forEach((_, i) => { rig[`stem${i}`] = { ...WIND_NODES.leaf, bend: 0.18, lag: 0.06 + i * 0.04 }; });
  return rig;
}
const FLOWER_CLUSTER_RIG = makeFlowerClusterRig();
type FlowerClusterRigKey = keyof typeof FLOWER_CLUSTER_RIG;
const FLOWER_TONES = [OUT_FLOWER_RED, OUT_FLOWER_YELLOW, OUT_BLOSSOM_PINK, OUT_FLOWER_PURPLE];
function FlowerClusterModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<FlowerClusterRigKey>(rootRef, FLOWER_CLUSTER_RIG, { seed: instanceId, radius: 0.6 });
  return (
    <group ref={rootRef} scale={scale}>
      {FLOWER_CLUSTER_STEMS.map(([x, z, h, tone], i) => (
        <group key={`stem-${i}`} ref={rig.ref(`stem${i}` as FlowerClusterRigKey)} position={[x, 0, z]}>
          <mesh position={[0, h / 2, 0]} castShadow>
            <cylinderGeometry args={[0.007, 0.010, h, 5]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
          <mesh position={[0, h, 0]} castShadow>
            <sphereGeometry args={[0.045, 6, 6]} />
            <meshStandardMaterial color={FLOWER_TONES[tone]} roughness={0.75} />
          </mesh>
        </group>
      ))}
      {/* 底部一小撮葉子，讓花叢不是光禿禿插在土裡 */}
      <mesh position={[0, 0.03, 0]} scale={[1, 0.4, 1]} receiveShadow>
        <sphereGeometry args={[0.10, 7, 5]} />
        <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** 單株大型花 —— 單莖單一大花頭，存在感靠尺寸而不是叢聚。 */
const SINGLE_FLOWER_RIG = { stem: { ...WIND_NODES.leaf, bend: 0.14, lag: 0.06 } } as const;
type SingleFlowerRigKey = keyof typeof SINGLE_FLOWER_RIG;
function SingleFlowerModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<SingleFlowerRigKey>(rootRef, SINGLE_FLOWER_RIG, { seed: instanceId, radius: 0.6 });
  const petalCount = 6;
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.02, 0]} scale={[1, 0.35, 1]} receiveShadow>
        <sphereGeometry args={[0.11, 7, 5]} />
        <meshStandardMaterial color={OUT_LEAF} roughness={0.9} />
      </mesh>
      <group ref={rig.ref('stem')} position={[0, 0, 0]}>
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.014, 0.020, 0.44, 6]} />
          <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
        </mesh>
        {/* 兩片莖葉 */}
        {[-1, 1].map((s) => (
          <mesh key={`stemleaf-${s}`} position={[s * 0.08, 0.16, 0]} rotation={[0, 0, s * 0.7]} scale={[0.3, 1, 1]} castShadow>
            <capsuleGeometry args={[0.03, 0.10, 3, 5]} />
            <meshStandardMaterial color={OUT_LEAF} roughness={0.85} />
          </mesh>
        ))}
        {/* 花頭：一圈花瓣＋花心 */}
        {/*
          花頭。改版前六片花瓣是半徑 0.09 的球、擺在離圓心 0.09 的地方 —— 每一片都吃掉隔壁那片
          的一半，六片黏成一塊，遠看就是一個紅色六邊形。商店縮圖畫的是一朵有六片分開的花瓣、
          中間一顆黃色花心的花；「花瓣分得開」正是「這是一朵花」這件事的全部。

          現在花瓣是**拉長並推出去**的：半徑 0.075、沿自己的長軸拉到 1.75 倍、圓心推到 0.115，
          相鄰兩片只在根部相接。花瓣數不變（六片），mesh 數也不變。
        */}
        <group position={[0, 0.46, 0]}>
          {Array.from({ length: petalCount }).map((_, i) => {
            const a = (i / petalCount) * Math.PI * 2;
            return (
              <mesh
                key={`petal-${i}`}
                position={[Math.cos(a) * 0.115, 0.005, Math.sin(a) * 0.115]}
                rotation={[0, -a, 0]}
                scale={[1.75, 0.30, 0.80]}
                castShadow
              >
                <sphereGeometry args={[0.075, 6, 5]} />
                <meshStandardMaterial color={i % 2 === 0 ? OUT_FLOWER_RED : OUT_FRUIT} roughness={0.7} />
              </mesh>
            );
          })}
          <mesh castShadow>
            <sphereGeometry args={[0.058, 7, 6]} />
            <meshStandardMaterial color={OUT_FLOWER_YELLOW} roughness={0.7} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** 熱帶花卉（鳥蕉風）—— 尖狀花苞造型，跟圓花瓣的花完全不同輪廓。 */
const TROPICAL_FLOWER_RIG = { stem: { ...WIND_NODES.leaf, bend: 0.12, lag: 0.05 } } as const;
type TropicalFlowerRigKey = keyof typeof TROPICAL_FLOWER_RIG;
function TropicalFlowerModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<TropicalFlowerRigKey>(rootRef, TROPICAL_FLOWER_RIG, { seed: instanceId, radius: 0.7 });
  return (
    <group ref={rootRef} scale={scale}>
      {/* 兩片長葉，交錯。商店縮圖的葉子是 4.5 單位粗、佔畫面三分之一寬的兩道弧；模型這邊的
          `scale={[0.22, …]}` 把 5 公分的膠囊壓成 1.1 公分，島上讀成兩根綠色的線。壓扁是對的
          （葉子是片不是管），但要壓的是**厚度**那一軸，寬度得留著。 */}
      {[-0.55, 0.5].map((rot, i) => (
        <mesh key={`leaf-${i}`} position={[0, 0.24, 0]} rotation={[0, rot, 0.16]} scale={[1, 1, 0.26]} castShadow receiveShadow>
          <capsuleGeometry args={[0.075, 0.44, 3, 6]} />
          <meshStandardMaterial color={i === 0 ? OUT_LEAF : OUT_LEAF_DARK} roughness={0.85} />
        </mesh>
      ))}
      <group ref={rig.ref('stem')}>
        <mesh position={[0, 0.30, 0]} rotation={[0.12, 0, 0]} castShadow>
          <cylinderGeometry args={[0.014, 0.018, 0.56, 6]} />
          <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
        </mesh>
        {/* 尖狀苞片：一片朝上的深色船形苞，插著三片橙紫尖瓣 */}
        {/* 苞與花瓣。縮圖上這朵鳥蕉是**三片撇開的尖瓣**、紫／橙／黃各一，而且大到佔了畫面上半。
            改版前三片瓣同一個橙色、又被壓到 0.22 寬，湊在一起是一根橘色的小刺。現在瓣加大、
            三色分開，撇角也拉開 —— 鳥蕉的辨識就是那個「一把散開的火柴」的形狀。 */}
        <group position={[0, 0.60, 0.03]} rotation={[0.35, 0, 0]}>
          <mesh rotation={[0.4, 0, 0]} scale={[1, 1, 0.42]} castShadow>
            <coneGeometry args={[0.085, 0.34, 4]} />
            <meshStandardMaterial color={OUT_FLOWER_PURPLE} roughness={0.7} />
          </mesh>
          {([[0.055, -0.34, OUT_FRUIT], [0.115, -0.06, OUT_FLOWER_YELLOW], [0.165, 0.24, OUT_FRUIT]] as const).map(
            ([y, tilt, colour], i) => (
              <mesh key={`spike-${i}`} position={[0, y, 0.02]} rotation={[tilt, 0, (i - 1) * 0.26]} scale={[1, 1, 0.40]} castShadow>
                <coneGeometry args={[0.055, 0.30, 4]} />
                <meshStandardMaterial color={colour} roughness={0.65} />
              </mesh>
            )
          )}
        </group>
      </group>
    </group>
  );
}

/** 野花地毯 —— 低矮密集的多色小花點，整叢共用一個風節點（不逐朵動）。 */
const FLOWER_CARPET_RIG = { mat: { ...WIND_NODES.leaf, bend: 0.05, lag: 0.06 } } as const;
type FlowerCarpetRigKey = keyof typeof FLOWER_CARPET_RIG;
const CARPET_DOTS: readonly (readonly [number, number, number])[] = [
  [-0.22, -0.16, 0], [-0.08, -0.22, 1], [0.10, -0.18, 2], [0.24, -0.10, 0], [-0.20, 0.04, 1], [0.02, 0.02, 3],
  [0.20, 0.08, 2], [-0.10, 0.18, 0], [0.08, 0.22, 1], [-0.24, 0.20, 3],
];
function FlowerCarpetModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<FlowerCarpetRigKey>(rootRef, FLOWER_CARPET_RIG, { seed: instanceId, radius: 0.6 });
  const tones = [OUT_FLOWER_RED, OUT_FLOWER_YELLOW, OUT_BLOSSOM_PINK, OUT_FLOWER_PURPLE];
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.34, 14]} />
        <meshStandardMaterial color={OUT_LEAF} roughness={0.95} />
      </mesh>
      <group ref={rig.ref('mat')}>
        {CARPET_DOTS.map(([x, z, tone], i) => (
          <mesh key={`dot-${i}`} position={[x, 0.025, z]} castShadow>
            <sphereGeometry args={[0.032, 5, 5]} />
            <meshStandardMaterial color={tones[tone]} roughness={0.75} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------------- 地被植物（Low Layer） */

/** 草叢 —— 細長葉片束，貼地放射狀，填補大型物件之間的空地。 */
const GRASS_BLADES: readonly (readonly [number, number, number])[] = [
  [0.0, 0.20, 0], [0.9, 0.24, 1], [1.8, 0.17, 2], [2.7, 0.22, 0], [3.6, 0.19, 1],
  [4.4, 0.23, 2], [5.2, 0.18, 0], [5.9, 0.21, 1],
];
function makeGrassRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {};
  GRASS_BLADES.forEach((_, i) => { rig[`blade${i}`] = { ...WIND_NODES.grass, lag: i * 0.02 }; });
  return rig;
}
const GRASS_RIG = makeGrassRig();
type GrassRigKey = keyof typeof GRASS_RIG;
function GrassTuftModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<GrassRigKey>(rootRef, GRASS_RIG, { seed: instanceId, radius: 0.5 });
  return (
    <group ref={rootRef} scale={scale}>
      {GRASS_BLADES.map(([a, len, tone], i) => (
        <group key={`blade-${i}`} ref={rig.ref(`blade${i}` as GrassRigKey)} rotation={[0, a, 0]}>
          <mesh position={[0.05, len / 2, 0]} rotation={[0, 0, -0.35]} scale={[0.18, 1, 1]} castShadow>
            <capsuleGeometry args={[0.03, len * 0.75, 2, 5]} />
            <meshStandardMaterial color={tone === 0 ? OUT_LEAF : tone === 1 ? OUT_LEAF_LIGHT : OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * 蕨類 —— 羽狀複葉從基部輻射，每片葉子自己再排一列小葉，跟草叢的細直葉明顯不同。
 *
 * 四片而不是三片，而且每片的小葉不再是一片一個 mesh。商店縮圖畫的是一叢對稱、飽滿的羽狀葉；
 * 改版前三片葉子各掛四片小葉，在島上讀成幾根岔開的細刺 —— 「羽狀複葉」這個唯一的識別特徵，
 * 得先有夠多的小葉才看得出是羽狀的。
 *
 * 但小葉一片一個 mesh 是條死路：一次把它加到五片葉子、每片八小葉，這件商品就變成 45 個 mesh，
 * 而它在 Outdoor Asset Quality Standard 裡是 Small 級距、上限 16（scripts/audit-outdoor-quality.ts）。
 * 蕨類是玩家會沿著步道種一整排的東西，那個上限不是形式主義。
 *
 * 所以每一「對」小葉是**一個橫跨葉軸的 mesh**，而不是左右各一個：羽狀複葉看起來像一道道橫檔，
 * 一根壓扁的膠囊從葉軸兩側同時伸出去，讀起來一模一樣，數量卻只有一半。四片葉子 × (1 葉軸 +
 * 3 橫檔) = 16，剛好落在預算上，而且比改版前的 15 個 mesh 密。
 */
const FERN_FRONDS: readonly (readonly [number, number])[] = [
  [0.0, 0.32], [1.57, 0.27], [3.14, 0.31], [4.71, 0.26],
];
function makeFernRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {};
  FERN_FRONDS.forEach((_, i) => { rig[`frond${i}`] = { ...WIND_NODES.grass, bend: 0.18, lag: 0.04 + i * 0.03 }; });
  return rig;
}
const FERN_RIG = makeFernRig();
type FernRigKey = keyof typeof FERN_RIG;
function FernModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<FernRigKey>(rootRef, FERN_RIG, { seed: instanceId, radius: 0.5 });
  /* 一對小葉沿葉軸的位置，以及它在那個高度該有多寬 —— 靠近葉尖的窄，這是羽狀複葉的錐形輪廓。 */
  const leaflets: readonly (readonly [number, number])[] = [
    [0.32, 1.00], [0.58, 0.80], [0.84, 0.52],
  ];
  return (
    <group ref={rootRef} scale={scale}>
      {FERN_FRONDS.map(([a, len], i) => (
        <group key={`frond-${i}`} ref={rig.ref(`frond${i}` as FernRigKey)} rotation={[0, a, 0]}>
          <group rotation={[-0.55, 0, 0]}>
            <mesh position={[0, len / 2, 0]} castShadow>
              <cylinderGeometry args={[0.009, 0.014, len, 4]} />
              <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
            </mesh>
            {/* 一對小葉 = 一根橫跨葉軸的扁膠囊。膠囊自己的軸是 y，繞 z 轉 90° 讓它橫過來，
                再壓扁 z 讓它是一片葉而不是一根管。 */}
            {leaflets.map(([t, wide], j) => (
              <mesh
                key={`leaflet-${j}`}
                position={[0, len * t, 0]}
                rotation={[0, 0, Math.PI / 2]}
                scale={[1, wide, 0.34]}
                castShadow
              >
                <capsuleGeometry args={[0.040, 0.16, 2, 6]} />
                <meshStandardMaterial color={j % 2 === 0 ? OUT_LEAF : OUT_LEAF_LIGHT} roughness={0.9} />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </group>
  );
}

/** 小型葉片植物 —— 少數幾片寬闊心形葉，低矮，跟草叢／蕨類的細葉都不同。 */
const LEAF_PLANT_RIG = {
  leaf0: { ...WIND_NODES.leaf, lag: 0.05 },
  leaf1: { ...WIND_NODES.leaf, lag: 0.09 },
  leaf2: { ...WIND_NODES.leaf, lag: 0.13 },
  leaf3: { ...WIND_NODES.leaf, lag: 0.17 },
} as const;
type LeafPlantRigKey = keyof typeof LEAF_PLANT_RIG;
const LEAF_PLANT_TONES = [OUT_LEAF, OUT_LEAF_LIGHT, OUT_LEAF_DARK];
function LeafPlantModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<LeafPlantRigKey>(rootRef, LEAF_PLANT_RIG, { seed: instanceId, radius: 0.45 });
  const leaves: [LeafPlantRigKey, number, number][] = [
    ['leaf0', 0, 0.20], ['leaf1', 1.6, 0.17], ['leaf2', 3.1, 0.19], ['leaf3', 4.7, 0.15],
  ];
  return (
    <group ref={rootRef} scale={scale}>
      {/*
        每片葉子是「一根往外斜上的葉柄 ＋ 一片壓扁的圓葉」。

        改版前葉柄幾乎躺平（繞 X 轉 1.35 弧度 ≈ 77°）而葉片是 [1, 0.8, 0.55] 的球 —— 也就是四顆
        貼在地上的綠球，量出來 1.10 寬、0.36 高。商店縮圖畫的是兩片**架在莖上、圓圓的葉子**，
        跟旁邊那幾叢細葉地被的差別就在「圓葉 ＋ 看得見的莖」。

        現在葉柄抬到 45° 左右，葉片壓成 0.22 的厚度（真的是一片，不是一顆），高度因此追上寬度。
      */}
      {leaves.map(([key, a, r], i) => (
        <group key={key} ref={rig.ref(key)} rotation={[0, a, 0]}>
          <mesh position={[0.075, 0.15, 0]} rotation={[0, 0, -0.48]} castShadow>
            <cylinderGeometry args={[0.011, 0.015, 0.34, 4]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
          <mesh position={[0.165, 0.325, 0]} rotation={[0, 0, -0.38]} scale={[1, 0.22, 1]} castShadow receiveShadow>
            <sphereGeometry args={[r * 0.95, 9, 6]} />
            <meshStandardMaterial color={LEAF_PLANT_TONES[i % LEAF_PLANT_TONES.length]} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** 野生植物叢 —— 混合高度的雜生植株，最不規則的一種地被，填視覺縫隙用。 */
const WILD_GROUNDCOVER_RIG = {
  a: { ...WIND_NODES.grass, lag: 0.03 },
  b: { ...WIND_NODES.grass, lag: 0.08 },
  c: { ...WIND_NODES.leaf, lag: 0.12 },
} as const;
type WildGroundcoverRigKey = keyof typeof WILD_GROUNDCOVER_RIG;
function WildGroundcoverModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<WildGroundcoverRigKey>(rootRef, WILD_GROUNDCOVER_RIG, { seed: instanceId, radius: 0.5 });
  return (
    <group ref={rootRef} scale={scale}>
      {/*
        三束高矮不一的葉片。商店縮圖畫的是三根**立起來**的草葉加一朵小黃花；改版前 c 那一束
        是一顆壓成 [1, 0.7, 0.5] 的球躺在地上，在草地上讀成一塊深色的汙漬，而兩根細葉又太細，
        整叢看起來像「地上有東西」而不是一叢雜草。

        現在三束都是立著的葉片、各自兩片，最矮的那束保留低伏的姿態當作層次。
      */}
      <group ref={rig.ref('a')} position={[-0.06, 0, 0.04]} rotation={[0, 0.4, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.022, 0.13, 0]} rotation={[0, 0, s * 0.30]} scale={[0.22, 1, 1]} castShadow>
            <capsuleGeometry args={[0.035, 0.20, 2, 5]} />
            <meshStandardMaterial color={s < 0 ? OUT_LEAF : OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
        ))}
      </group>
      <group ref={rig.ref('b')} position={[0.07, 0, -0.05]} rotation={[0, 2.5, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.020, 0.10, 0]} rotation={[0, 0, s * 0.42]} scale={[0.22, 1, 1]} castShadow>
            <capsuleGeometry args={[0.030, 0.15, 2, 5]} />
            <meshStandardMaterial color={s < 0 ? OUT_LEAF_LIGHT : OUT_LEAF} roughness={0.9} />
          </mesh>
        ))}
      </group>
      <group ref={rig.ref('c')} position={[0.02, 0, 0.05]} rotation={[0, 1.2, 0]}>
        <mesh position={[0, 0.07, 0]} rotation={[0.45, 0, -0.25]} scale={[0.24, 1, 1]} castShadow receiveShadow>
          <capsuleGeometry args={[0.032, 0.11, 2, 5]} />
          <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
        </mesh>
      </group>
      {/* 一朵小小的野花，讓這叢雜草看起來是「長出來的」而不是修剪過的。花莖跟花頭都要有，
          不然它只是浮在草叢旁邊的一顆黃點。 */}
      <mesh position={[-0.05, 0.09, -0.07]} rotation={[0, 0, 0.16]} castShadow>
        <cylinderGeometry args={[0.007, 0.009, 0.18, 4]} />
        <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
      </mesh>
      <mesh position={[-0.035, 0.185, -0.07]} castShadow>
        <sphereGeometry args={[0.030, 6, 5]} />
        <meshStandardMaterial color={OUT_FLOWER_YELLOW} roughness={0.75} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------------- 特殊景觀植物 */

/** 大型熱帶葉片植物 —— 三片巨大單葉，存在感最強的中型量體，用粗壯莖桿撐開。 */
const LARGE_LEAF_POSES: readonly (readonly [number, number])[] = [[0, 0.62], [2.35, 0.56], [4.35, 0.60]];
function makeLargeLeafRig() {
  const rig: Record<string, { bend: number; cross?: number; lag?: number; axis?: 'x' | 'z' }> = {};
  LARGE_LEAF_POSES.forEach((_, i) => { rig[`leaf${i}`] = { ...WIND_NODES.leaf, bend: 0.13, lag: 0.08 + i * 0.05 }; });
  return rig;
}
const LARGE_LEAF_RIG = makeLargeLeafRig();
type LargeLeafRigKey = keyof typeof LARGE_LEAF_RIG;
function LargeTropicalLeafModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<LargeLeafRigKey>(rootRef, LARGE_LEAF_RIG, { seed: instanceId, radius: 1.4 });
  return (
    <group ref={rootRef} scale={scale}>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[0.13, 0.17, 0.12, 8]} />
        <meshStandardMaterial color={OUT_WOOD_SHADOW} roughness={0.95} />
      </mesh>
      {/* 兩根還沒展開的新芽，捲成尖錐，補上結構層次。

          第二根是放大到 1.95（特殊景觀級距）之後補的：三片大葉在那個尺寸下之間的空隙很大，
          單獨一根新芽從側面看只是一根立在土上的刺。兩根不等高、不同方向，才讀作「這株植物
          正在長」。矮的那一根用 OUT_LEAF，跟高的那根拉開一階。 */}
      <mesh position={[0, 0.30, 0]} rotation={[0.15, 0, 0]} castShadow>
        <coneGeometry args={[0.035, 0.32, 6]} />
        <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.85} />
      </mesh>
      <mesh position={[-0.075, 0.215, -0.055]} rotation={[-0.12, 0, -0.30]} castShadow>
        <coneGeometry args={[0.028, 0.215, 6]} />
        <meshStandardMaterial color={OUT_LEAF} roughness={0.85} />
      </mesh>
      {LARGE_LEAF_POSES.map(([a, len], i) => (
        <group key={`leaf-${i}`} ref={rig.ref(`leaf${i}` as LargeLeafRigKey)} position={[0, 0.10, 0]}>
          <group rotation={[0, a, 0]}>
            <mesh position={[0, len * 0.45, 0.05]} rotation={[0.30, 0, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.03, len * 0.9, 6]} />
              <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.85} />
            </mesh>
            {/*
              葉身。改版前是 `scale={[0.60, 1, 1]}` 的球 —— 也就是一顆稍微壓扁的球，三片湊起來
              讀成一叢圓灌木。商店縮圖畫的是三片**大而扁的單葉**，而「巨大單葉」正是這件商品跟
              旁邊那四種灌木唯一的差別，所以它非扁不可。

              壓的是 y：葉柄已經把整片葉子轉了 0.85 弧度躺下來，mesh 自己的 y 在那之後才是葉片的
              「厚度」那一軸。順帶把葉子加大到 0.40 並補一條中肋 —— low poly 的葉子靠輪廓與中線
              被認出來，不是靠面數。
            */}
            <mesh position={[0, len * 0.85, 0.28]} rotation={[0.85, 0, 0]} scale={[0.62, 0.14, 1]} castShadow receiveShadow>
              <sphereGeometry args={[0.40, 9, 7]} />
              <meshStandardMaterial color={i % 2 === 0 ? OUT_LEAF : OUT_LEAF_LIGHT} roughness={0.85} side={THREE.DoubleSide} />
            </mesh>
            {/* 中肋。葉面轉了 0.85 弧度，所以它的法線是 (0, cos 0.85, sin 0.85)；沿著那個方向
                推 0.030 才會浮在葉子上面而不是埋在裡面，而圓柱自己要再轉 π/2 才會躺著沿葉長走。 */}
            <mesh
              position={[0, len * 0.85 + 0.020, 0.28 + 0.022]}
              rotation={[0.85 + Math.PI / 2, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.014, 0.022, 0.70, 5]} />
              <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/** 蘑菇叢 —— 大小不一的菇傘與菇柄，圓頂輪廓，全場獨有；菇類不擺動，也省效能。 */
/**
 * [x, z, 菇傘半徑, 菌柄高度]。
 *
 * 高度改版前是 1.0 / 0.65 / 0.78，配上 0.15 / 0.10 / 0.115 的傘 —— 也就是一根高度是傘半徑
 * 六倍半的柄。商店縮圖畫的是三朵矮胖的紅傘白點菇，島上長出來的是三根頂著小圓片的細高蹺，
 * 而且因為量到的整體高度 (1.44) 比寬度 (0.56) 還大，連「這是一叢地上的菇」都讀不出來。
 *
 * 現在柄高大約是傘半徑的兩倍，也就是縮圖上的比例。
 */
const MUSHROOMS: readonly (readonly [number, number, number, number])[] = [
  [0.00, 0.00, 0.17, 0.32], [0.13, 0.11, 0.11, 0.19], [-0.12, -0.08, 0.13, 0.24],
];
/** 每株菇傘上的白點數 —— 大的多幾顆，小的一兩顆就夠，是省 mesh 預算的地方。 */
const MUSHROOM_SPOTS: readonly (readonly [number, number])[][] = [
  [[-0.4, 0.3], [0.3, 0.5]], [[0, -0.4]], [[0.3, 0]],
];
function MushroomClusterModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {MUSHROOMS.map(([x, z, cap, h], i) => (
        <group key={`mush-${i}`} position={[x, 0, z]}>
          <mesh position={[0, h * 0.5, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[cap * 0.28, cap * 0.34, h, 7]} />
            <meshStandardMaterial color={OUT_MUSHROOM_STEM} roughness={0.85} />
          </mesh>
          <mesh position={[0, h, 0]} scale={[1, 0.62, 1]} castShadow receiveShadow>
            <sphereGeometry args={[cap, 9, 6]} />
            <meshStandardMaterial color={OUT_MUSHROOM_CAP} roughness={0.7} />
          </mesh>
          {i === 0 && (
            <mesh position={[0, h + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[cap * 0.15, cap * 0.9, 10]} />
              <meshStandardMaterial color={OUT_MUSHROOM_STEM} roughness={0.9} {...DECAL_DEPTH_BIAS} />
            </mesh>
          )}
          {/*
            菇傘上的白點。位置是**算在傘面上**的，不是填的高度：傘是一顆半徑 cap、y 壓成 0.62
            的球，所以水平離軸 u·cap 的地方，傘面高度是 h + 0.62·cap·√(1−u²)。改版前白點固定
            擺在 h + 0.30·cap，那個高度在傘面**底下** —— 三朵菇的白點全部埋在紅色傘裡，縮圖上
            最醒目的那個特徵在島上一顆都看不到。

            再往外推 0.55 個點半徑，讓白點浮在傘面上而不是切進去。
          */}
          {MUSHROOM_SPOTS[i].map(([px, pz], j) => {
            const u = Math.hypot(px, pz);
            const spotR = cap * 0.17;
            const surfaceY = h + cap * 0.62 * Math.sqrt(Math.max(0, 1 - u * u));
            return (
              <mesh
                key={`spot-${j}`}
                position={[px * cap, surfaceY + spotR * 0.55, pz * cap]}
                castShadow
              >
                <sphereGeometry args={[spotR, 5, 5]} />
                <meshStandardMaterial color={OUT_BLOSSOM_WHITE} roughness={0.8} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** 仙人掌 —— 稜線分割的柱狀主體加兩支掌狀分枝，色系偏灰綠，靜止不動。 */
function CactusModel({ scale }: FurnitureModelProps) {
  // 六道稜、四根刺。手臂從一根斜棒變成兩段 L 形之後多了兩個 mesh，而柱身收細也把這件商品從
  // Medium 掉進 Small 級距（預算 16）—— 所以細節從「數量」搬到「輪廓」：稜線少兩道沒人看得出來，
  // 手臂的轉折是一眼就認得的。見 scripts/audit-outdoor-quality.ts。
  const ribs = 6;
  return (
    <group scale={scale}>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[0.16, 0.18, 0.06, 12]} />
        <meshStandardMaterial color={OUT_STONE} roughness={0.95} />
      </mesh>
      {/* 柱身。比改版前細一點、高一點（0.28 粗 × 0.62 高 → 0.25 × 0.80）：商店縮圖的柱狀
          仙人掌是 12/38 的細長比例，之前那個比例讀成一截水管。 */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.115, 0.135, 0.80, 10]} />
        <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.8} />
      </mesh>
      {Array.from({ length: ribs }).map((_, i) => {
        const a = (i / ribs) * Math.PI * 2;
        return (
          <mesh key={`rib-${i}`} position={[Math.cos(a) * 0.122, 0.45, Math.sin(a) * 0.122]} rotation={[0, -a, 0]} castShadow>
            <boxGeometry args={[0.012, 0.76, 0.03]} />
            <meshStandardMaterial color={OUT_LEAF} roughness={0.85} />
          </mesh>
        );
      })}
      {/*
        兩支掌狀分枝，各自「先橫出去、再往上長」。

        改版前一支分枝是一根斜著向下外方的膠囊，兩支加起來像柱子上長了兩隻短翅膀 —— 而商店縮圖
        畫的是標準的仙人掌剪影：兩條從主幹橫出去再轉上來的手臂，一高一低。那個 L 形轉折就是
        「仙人掌」這個輪廓的全部，一根斜棒做不出來。

        一支手臂兩個 mesh（橫段＋豎段），兩支共四個；下面的刺從十根減到八根補回預算。
      */}
      {([[-1, 0.40, 0.26], [1, 0.56, 0.32]] as const).map(([s, elbowY, riseLen]) => (
        <group key={`arm-${s}`}>
          <mesh position={[s * 0.155, elbowY, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <capsuleGeometry args={[0.058, 0.13, 3, 8]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.8} />
          </mesh>
          <mesh position={[s * 0.215, elbowY + riseLen / 2 + 0.02, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[0.058, riseLen, 3, 8]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* 刺，一圈小點 */}
      {Array.from({ length: 4 }).map((_, i) => {
        const a = (i / 4) * Math.PI * 2 + 0.5;
        const y = 0.20 + (i % 3) * 0.22;
        return (
          <mesh key={`spine-${i}`} position={[Math.cos(a) * 0.132, y, Math.sin(a) * 0.132]} rotation={[Math.PI / 2, 0, -a]}>
            <coneGeometry args={[0.007, 0.035, 3]} />
            <meshStandardMaterial color={OUT_STONE_LIGHT} roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * 藤蔓棚架的拱頂 —— 從弧線上的點**算出**每一段的位置、長度與傾角。
 *
 * 改版前這裡是三個手填的 `[x, y, rotZ]`，而那三個 rotZ 是 -0.35 / 0 / 0.35：圓柱自己的軸是 +Y，
 * 所以 rotZ=0 的那一段是一根**直立**的柱子，±0.35 也只是歪了 20°。三段「拱」實際畫出來是三根
 * 從架子頂端往上戳的短棒，商店縮圖上那道明顯的木拱在島上完全不存在 —— 玩家看到的是兩根光禿禿
 * 的柱子。這是這次掃描裡最嚴重的一件。
 *
 * 現在的做法是：先寫下拱線上的五個點（一條把兩根立柱頂端接起來的拋物線），再由相鄰兩點求出
 * 中點、長度與「圓柱要轉多少才會指向這個方向」。角度是解出來的而不是填的，所以拱的高度或立柱
 * 的間距改了，拱自己會跟著對。
 */
const TRELLIS_POST_X = 0.62;
const TRELLIS_POST_TOP = 1.22;
const TRELLIS_ARCH_RISE = 0.34;
const TRELLIS_ARCH = (() => {
  const points: [number, number][] = [-1, -0.5, 0, 0.5, 1].map((u) => [
    u * TRELLIS_POST_X,
    TRELLIS_POST_TOP + TRELLIS_ARCH_RISE * (1 - u * u),
  ]);
  return points.slice(0, -1).map(([x0, y0], i) => {
    const [x1, y1] = points[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    return {
      position: [(x0 + x1) / 2, (y0 + y1) / 2, 0] as [number, number, number],
      length: Math.hypot(dx, dy),
      // 圓柱軸 +Y 轉到 (dx, dy)：繞 Z 轉 -atan2(dx, dy)。
      rotation: [0, 0, -Math.atan2(dx, dy)] as [number, number, number],
    };
  });
})();
/** 拱頂正中央的高度 —— 藤蔓從這裡垂下來，所以它得跟拱是同一個數字。 */
const TRELLIS_ARCH_APEX = TRELLIS_POST_TOP + TRELLIS_ARCH_RISE;

/** 藤蔓棚架 —— 木製拱門，垂墜的藤蔓是全場唯一「結構＋植物」的複合物件。 */
const VINE_TRELLIS_RIG = {
  vine0: { ...WIND_NODES.hanging, lag: 0.10 },
  vine1: { ...WIND_NODES.hanging, lag: 0.16 },
  vine2: { ...WIND_NODES.hanging, lag: 0.22 },
} as const;
type VineTrellisRigKey = keyof typeof VINE_TRELLIS_RIG;
function VineTrellisModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rig = useWindRig<VineTrellisRigKey>(rootRef, VINE_TRELLIS_RIG, { seed: instanceId, radius: 1.4 });
  const vines: [VineTrellisRigKey, number, number][] = [['vine0', -0.40, 0.62], ['vine1', 0, 0.46], ['vine2', 0.40, 0.70]];
  return (
    <group ref={rootRef} scale={scale}>
      {/* 兩根立柱 */}
      {[-TRELLIS_POST_X, TRELLIS_POST_X].map((x) => (
        <mesh key={`post-${x}`} position={[x, TRELLIS_POST_TOP / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.05, 0.065, TRELLIS_POST_TOP, 8]} />
          <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* 拱頂：四段沿著 TRELLIS_ARCH 的弧線接起來，每一段的傾角是算出來的。 */}
      {TRELLIS_ARCH.map((seg, i) => (
        <mesh key={`arch-${i}`} position={seg.position} rotation={seg.rotation} castShadow>
          <cylinderGeometry args={[0.042, 0.042, seg.length + 0.03, 6]} />
          <meshStandardMaterial color={i % 2 === 0 ? OUT_WOOD_DARK : OUT_WOOD} roughness={0.9} />
        </mesh>
      ))}
      {/* 兩根橫檔把立柱綁在一起 —— 沒有它，兩根柱子跟頭上的拱是三個各自站著的東西。 */}
      {[0.42, 0.86].map((y) => (
        <mesh key={`rail-${y}`} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.024, 0.024, TRELLIS_POST_X * 2, 6]} />
          <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
        </mesh>
      ))}
      {/* 格柵，兩根斜撐交叉在兩側柱子上 */}
      {[-TRELLIS_POST_X, TRELLIS_POST_X].map((x) =>
        [-1, 1].map((s) => (
          <mesh key={`lattice-${x}-${s}`} position={[x, 0.62, 0]} rotation={[0, 0, s * 0.5]} castShadow>
            <boxGeometry args={[0.022, 0.90, 0.022]} />
            <meshStandardMaterial color={OUT_WOOD} roughness={0.9} />
          </mesh>
        ))
      )}
      {/* 垂墜藤蔓：三串，長度不同，各自的葉子沿長度散布。
          藤與葉都比改版前粗一倍 —— 半徑 0.010 的莖與 0.03 的葉子在島上的縮放（0.85×1.55）下
          只有一公分多，等於畫了三條看不見的線；縮圖上那三串明顯的綠色藤蔓要在模型上成立，
          葉子就得有面積。 */}
      {vines.map(([key, x, len]) => (
        <group key={key} ref={rig.ref(key)} position={[x, TRELLIS_ARCH_APEX - 0.06, 0]}>
          <mesh position={[0, -len / 2, 0]} castShadow>
            <cylinderGeometry args={[0.016, 0.020, len, 5]} />
            <meshStandardMaterial color={OUT_LEAF_DARK} roughness={0.9} />
          </mesh>
          {[0.22, 0.48, 0.74, 0.96].map((t, j) => (
            <mesh
              key={`vleaf-${j}`}
              position={[0.055 * (j % 2 === 0 ? 1 : -1), -len * t, 0.01 * (j % 2 === 0 ? 1 : -1)]}
              rotation={[0, j * 0.7, j % 2 === 0 ? 0.75 : -0.75]}
              scale={[1, 1, 0.32]}
              castShadow
            >
              <capsuleGeometry args={[0.055, 0.07, 2, 6]} />
              <meshStandardMaterial color={j % 2 === 0 ? OUT_LEAF : OUT_LEAF_LIGHT} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** 水生植物盆 —— 淺盆＋平躺荷葉＋一朵睡蓮，全場唯一水平／貼面的植物輪廓，靜止不動。 */
function WaterLilyPlanterModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.38, 0.34, 0.14, 14]} />
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.135, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.03, 6, 14]} />
        <meshStandardMaterial color={OUT_STONE} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.33, 0.33, 0.03, 14]} />
        <meshStandardMaterial color={OUT_WATER} emissive={OUT_WATER} emissiveIntensity={0.3} transparent opacity={0.75} roughness={0.2} />
      </mesh>
      {/* 兩片平躺的荷葉，一缺口的圓片 */}
      {[[-0.12, 0.08, 0.16, 0.6], [0.14, -0.10, 0.13, 2.4]].map(([x, z, r, rotY], i) => (
        <mesh key={`pad-${i}`} position={[x, 0.155, z]} rotation={[-Math.PI / 2, 0, rotY]} castShadow>
          <circleGeometry args={[r, 10, 0.4, Math.PI * 1.8]} />
          <meshStandardMaterial color={i === 0 ? OUT_LEAF : OUT_LEAF_DARK} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 一朵睡蓮，跟單株大型花共用花瓣技法但花頭貼在水面上 */}
      <group position={[0.02, 0.16, -0.10]}>
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={`petal-${i}`} position={[Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055]} rotation={[0.3, -a, 0]} scale={[1, 0.3, 1]} castShadow>
              <sphereGeometry args={[0.06, 6, 5]} />
              <meshStandardMaterial color={OUT_BLOSSOM_WHITE} roughness={0.7} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.03, 6, 5]} />
          <meshStandardMaterial color={OUT_FLOWER_YELLOW} roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 展示用衝浪板 — a board ON A RACK, which is what 「展示用」 means and what its icon shows.
 * It used to be a bare rotated box hanging in mid-air at y=0.8 with nothing under it.
 */
function SurfboardModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* A-frame rack: two crossed legs each side, joined by a spreader. */}
      {[-0.34, 0.34].map((z) => (
        <group key={`frame-${z}`} position={[0, 0, z]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.16, 0.34, 0]} rotation={[0, 0, s * 0.42]} castShadow>
              <boxGeometry args={[0.06, 0.72, 0.06]} />
              <meshStandardMaterial color="#a3773f" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.06, 0.06, 0.82]} />
        <meshStandardMaterial color="#8a6435" roughness={0.9} />
      </mesh>
      {/* Two cradle pads the board rests in. */}
      {[-0.3, 0.3].map((z) => (
        <mesh key={`pad-${z}`} position={[0, 0.66, z]} castShadow>
          <boxGeometry args={[0.16, 0.07, 0.14]} />
          <meshStandardMaterial color="#e5d6bd" roughness={1} />
        </mesh>
      ))}
      {/* The board: a long capsule (so nose and tail are round), leaning back on the rack. */}
      <group position={[0, 0.98, -0.02]} rotation={[0.22, 0, 0.06]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.26, 1.34, 6, 14]} />
          <meshStandardMaterial color="#f4f1e6" roughness={0.35} />
        </mesh>
        {/* Two stripes down the deck and a contrasting nose block. */}
        <mesh position={[0, 0.02, 0.2]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.055, 1.28, 4, 10]} />
          <meshStandardMaterial color="#f43f5e" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.02, -0.2]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.055, 1.28, 4, 10]} />
          <meshStandardMaterial color="#14b8a6" roughness={0.4} />
        </mesh>
        {/* Fin on the underside, near the tail. */}
        <mesh position={[-0.6, -0.16, 0]} rotation={[0, 0, 0.2]} castShadow>
          <coneGeometry args={[0.11, 0.22, 3]} />
          <meshStandardMaterial color="#0f766e" roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/** 竹製手電筒 — a bamboo-cased torch lying on its stand, lens forward. */
function BambooFlashlightModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Little wooden cradle it rests in. */}
      {[-0.13, 0.13].map((z) => (
        <mesh key={`cradle-${z}`} position={[0, 0.035, z]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.07, 0.05]} />
          <meshStandardMaterial color="#8a6435" roughness={0.9} />
        </mesh>
      ))}
      {/* Bamboo barrel — three segments with raised nodes between them. */}
      <mesh position={[0, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.075, 0.42, 12]} />
        <meshStandardMaterial color="#c7b370" roughness={0.85} />
      </mesh>
      {[-0.07, 0.09].map((z) => (
        <mesh key={`node-${z}`} position={[0, 0.13, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.083, 0.083, 0.025, 12]} />
          <meshStandardMaterial color="#a89355" roughness={0.9} />
        </mesh>
      ))}
      {/* Flared head and lens, pointing +z. */}
      <mesh position={[0, 0.13, 0.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.078, 0.1, 12]} />
        <meshStandardMaterial color="#8a7a45" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.13, 0.302]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.095, 0.095, 0.02, 12]} />
        <meshStandardMaterial color="#fff6d8" emissive="#ffe6a0" emissiveIntensity={1.1} />
      </mesh>
      {/* Rear cap, switch, and a leather wrist loop. */}
      <mesh position={[0, 0.13, -0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.068, 0.068, 0.05, 12]} />
        <meshStandardMaterial color="#6f5c31" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.205, 0.02]} castShadow>
        <boxGeometry args={[0.05, 0.025, 0.07]} />
        <meshStandardMaterial color="#3f3a2c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.13, -0.27]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.045, 0.011, 5, 10]} />
        <meshStandardMaterial color="#8a6a4a" roughness={0.95} />
      </mesh>
      {/* Its own battery, so it stays lit with the room lights off. */}
      <FixtureLight item={item} position={[0, 0.13, 0.4]} />
    </group>
  );
}

/** 復古收音機 — a walnut tabletop set: fabric grille, tuning dial, two knobs, a telescopic aerial. */
/**
 * 復古收音機 —— 轉開收音機, and one of the two pieces in the game that STAY on.
 *
 * `toggle` in constants/objectAnimations.ts: press E and it plays, press E again and it stops,
 * and walking away does neither — which is what a radio is for. The tuning knob turns a
 * three-quarter turn with it, the needle wanders across the dial, and the sound waves off the
 * grille are mounted by state, so a silent radio draws none of them.
 */
function RetroRadioModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Case. */}
      <mesh position={[0, 0.19, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.56, 0.34, 0.22]} />
        <meshStandardMaterial color="#7b4a24" roughness={0.7} />
      </mesh>
      {/* Rounded shoulders — two half-cylinders capping the top edge. */}
      <mesh position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 0.55, 12, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#8b5a2c" roughness={0.7} />
      </mesh>
      {/* Cream fabric speaker grille, inset on the left. */}
      <mesh position={[-0.14, 0.2, 0.115]} castShadow>
        <boxGeometry args={[0.24, 0.24, 0.02] } />
        <meshStandardMaterial color="#e8dcc0" roughness={1} />
      </mesh>
      {[-0.08, -0.02, 0.04].map((x, i) => (
        <mesh key={`slat-${i}`} position={[-0.14 + x, 0.2, 0.128]}>
          <boxGeometry args={[0.016, 0.2, 0.008]} />
          <meshStandardMaterial color="#c9b894" roughness={1} />
        </mesh>
      ))}
      {/* Tuning dial with a red needle. */}
      <mesh position={[0.14, 0.28, 0.115]}>
        <boxGeometry args={[0.2, 0.09, 0.02]} />
        <meshStandardMaterial color="#f7edd4" roughness={0.6} />
      </mesh>
      {anim.active && (
        <GlowPanel position={[0.14, 0.28, 0.126]} size={[0.19, 0.08]} color="#ffdf9e" intensity={0.9} />
      )}
      <group position={[0.16, 0.28, 0.128]} ref={anim.ref('needle')}>
        <mesh>
          <boxGeometry args={[0.012, 0.075, 0.008]} />
          <meshStandardMaterial color="#dc2626" roughness={0.5} />
        </mesh>
      </group>
      {/* Two brass knobs. The left one is the tuner, and it carries a pointer — a plain cylinder
          turning about its own axis is a cylinder standing still. */}
      <group position={[0.07, 0.13, 0.125]} ref={anim.ref('knob')}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.03, 12]} />
          <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.021, 0.016]}>
          <boxGeometry args={[0.007, 0.022, 0.006]} />
          <meshStandardMaterial color="#3f3a2c" roughness={0.6} />
        </mesh>
      </group>
      <mesh position={[0.21, 0.13, 0.125]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.03, 12]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
      </mesh>
      {anim.active && <SoundWaves at={[-0.14, 0.2, 0.14]} facing="z" count={3} reach={0.22} />}
      {/* Telescopic aerial, leaning. */}
      <mesh position={[0.23, 0.56, -0.06]} rotation={[0, 0, -0.22]} castShadow>
        <cylinderGeometry args={[0.008, 0.012, 0.42, 6]} />
        <meshStandardMaterial color="#b8bec4" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Feet. */}
      {[-0.22, 0.22].map((x) => [-0.08, 0.08].map((z) => (
        <mesh key={`foot-${x}-${z}`} position={[x, 0.015, z]} castShadow>
          <cylinderGeometry args={[0.025, 0.022, 0.03, 8]} />
          <meshStandardMaterial color="#3f3a2c" roughness={0.8} />
        </mesh>
      )))}
    </group>
  );
}

function PottedPlantModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Terracotta pot */}
      <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.16, 0.28, 16]} />
        <meshStandardMaterial color="#c2703d" roughness={0.8} />
      </mesh>
      {/* Pot rim */}
      <mesh position={[0, 0.29, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.04, 16]} />
        <meshStandardMaterial color="#a85c30" roughness={0.7} />
      </mesh>
      {/* Soil. Its underside has to clear BOTH the rim's (y=0.27) and the
          trunk's (y=0.275) — 0.285 fixed the first and landed exactly on the
          second, so it sits at 0.29 (underside 0.28). */}
      <mesh position={[0, 0.29, 0]}>
        <cylinderGeometry args={[0.19, 0.19, 0.02, 16]} />
        <meshStandardMaterial color="#3f2a1d" roughness={1} />
      </mesh>
      {/* Mini trunk */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, 0.45, 8]} />
        <meshStandardMaterial color="#78350f" roughness={0.8} />
      </mesh>
      {/* Trimmed fan-palm fronds - same radial-capsule technique as the full-size 椰子樹, scaled down and neatly clipped */}
      <group position={[0, 0.75, 0]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} rotation={[0.5, (i * Math.PI * 2) / 6, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.32, 4, 8]} />
            <meshStandardMaterial color="#4d7c0f" roughness={0.85} />
          </mesh>
        ))}
        <mesh castShadow>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshStandardMaterial color="#365314" />
        </mesh>
      </group>
    </group>
  );
}

function WindowViewModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale} position={[0, 1.2, 0]}>
      {/* Outer Wooden window frame */}
      <mesh castShadow>
        <boxGeometry args={[2.8, 2.0, 0.12]} />
        <meshStandardMaterial color="#4a3b32" roughness={0.85} />
      </mesh>
      {/* Glass window pane backing */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[2.5, 1.7]} />
        <meshStandardMaterial
          color="#bae6fd"
          emissive="#e0f2fe"
          emissiveIntensity={0.25}
          roughness={0.1}
        />
      </mesh>
      {/* Wooden cross bars (divider) */}
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[2.5, 0.08, 0.06]} />
        <meshStandardMaterial color="#4a3b32" roughness={0.85} />
      </mesh>
      {/* The vertical bar crosses 2mm in front of the horizontal one. Sharing
          its exact Z put four coincident faces where they cross; both are the
          same brown so nothing shows today, but it is one recolour away from
          being visible and the audit treats coplanarity as a defect either way. */}
      <mesh position={[0, 0, 0.022]}>
        <boxGeometry args={[0.08, 1.7, 0.06]} />
        <meshStandardMaterial color="#4a3b32" roughness={0.85} />
      </mesh>
      {/* Subtle soft window sill shelf */}
      <mesh position={[0, -0.96, 0.12]} castShadow>
        <boxGeometry args={[3.1, 0.06, 0.32]} />
        <meshStandardMaterial color="#5c4d43" roughness={0.9} />
      </mesh>
      {/* A small flower vase outline on the sill */}
      <mesh position={[0.8, -0.8, 0.15]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 0.26, 12]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.3} opacity={0.9} transparent />
      </mesh>
    </group>
  );
}

/**
 * 暖陽落山圖 — and the reason it used to hang as a black rectangle.
 *
 * The frame was a SOLID BOX 0.06 deep, i.e. spanning z = -0.03 … +0.03, in near-black #2d2d2d.
 * Every other piece of the picture was authored in FRONT of the frame's centre but BEHIND its
 * front face: the canvas at 0.02, the sun at 0.0225, the two peaks at 0.025 and 0.0285. All four
 * were therefore sealed inside the frame's own solid, and what the player got for their 300 coins
 * was the outside of a dark box.
 *
 * That was not a texture, a shader, a loader or a cache — there is no texture in this model at
 * all, which is also why 「第二次顯示正常」 could never have been a caching difference; what
 * changes between two looks at it is only the camera-occlusion fade (BuildingInteriorView's
 * FurnitureItem drops a piece between you and the camera to 25%), which makes the buried picture
 * faintly visible through the box it is trapped in.
 *
 * A frame is a MOULDING, not a slab: four bars around an opening, with the canvas recessed inside
 * it. The picture is visible through the opening from frame one, the frame still reads as a frame
 * from an angle, and the piece's total depth is unchanged at 0.06 — so its measured standoff, its
 * collision box and `npm run audit:placements` all see exactly what they saw before.
 */
function CanvasArtModel({ scale }: FurnitureModelProps) {
  /** The picture, and the moulding's own section. Outer size stays the original 1.8 x 1.3. */
  const artW = 1.62;
  const artH = 1.12;
  const bar = 0.09;
  const frameDepth = 0.06;
  /** Front face of the canvas panel: everything painted on it is stepped forward from here. */
  const canvasFrontZ = 0.01;
  const outerW = artW + bar * 2;

  return (
    <group scale={scale} position={[0, 1.2, 0]}>
      {/* The moulding: four bars around an opening. Kept as separate boxes rather than one solid
          precisely so there IS an opening — see the note above. */}
      {([
        [0, artH / 2 + bar / 2, outerW, bar],
        [0, -artH / 2 - bar / 2, outerW, bar],
        [-artW / 2 - bar / 2, 0, bar, artH],
        [artW / 2 + bar / 2, 0, bar, artH],
      ] as const).map(([bx, by, bw, bh], i) => (
        <mesh key={i} position={[bx, by, 0]} castShadow>
          <boxGeometry args={[bw, bh, frameDepth]} />
          <meshStandardMaterial color="#2d2d2d" roughness={0.9} />
        </mesh>
      ))}

      {/* The canvas, recessed behind the moulding's front face and drawn a little wider than the
          opening so its own edges finish INSIDE the bars rather than coplanar with them. */}
      <mesh position={[0, 0, canvasFrontZ - 0.015]}>
        <boxGeometry args={[artW + 0.02, artH + 0.02, 0.03]} />
        <meshStandardMaterial color="#fdf6e8" roughness={0.95} />
      </mesh>

      {/* Geometric golden Sun / terracotta hills.
          Every shape here is FLAT — plates lying in the picture plane, each a fraction of a
          millimetre thick and stepped so no two faces are coplanar, and all of them between the
          canvas front (0.01) and the moulding's front face (0.03) so nothing protrudes.

          The peaks used to be full `coneGeometry` pyramids standing on the canvas with their axes
          along +Y, i.e. 0.5 units of solid geometry sticking out of a 0.06-thick frame. Nothing
          noticed while a painting was a floating floor object nobody could hang; the moment it
          became a wall piece, that depth WAS its standoff — the picture would have hung 60cm off
          the wall, and its collision box would have been twenty times the size of the picture.
          Caught by `npm run audit:placements`, which measures how deep a hanging piece is. */}
      {/* Warm sky wash across the upper canvas: what makes the disc read as a SETTING sun rather
          than as a dot on paper. */}
      <mesh position={[0, 0.14, canvasFrontZ + 0.002]}>
        <boxGeometry args={[artW, artH * 0.62, 0.001]} />
        <meshStandardMaterial color="#fbdcb0" roughness={1.0} />
      </mesh>
      <mesh position={[-0.18, 0.08, canvasFrontZ + 0.004]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.001, 32]} />
        <meshStandardMaterial color="#e8843c" roughness={1.0} />
      </mesh>
      {/* The horizon the sun is going down behind, so the picture has a ground line. */}
      <mesh position={[0, -0.4, canvasFrontZ + 0.006]}>
        <boxGeometry args={[artW, 0.2, 0.001]} />
        <meshStandardMaterial color="#c2410c" roughness={1.0} />
      </mesh>
      {/* The two hills. `rotation.y = PI` because a 3-sided cone laid into the picture plane puts
          its apex DOWNWARD at rest — which is what these were doing once the frame stopped hiding
          them, and a mountain that points down reads as a funnel. */}
      <mesh position={[0.24, -0.3, canvasFrontZ + 0.008]} rotation={[Math.PI / 2, Math.PI, 0]}>
        <cylinderGeometry args={[0, 0.4, 0.001, 3]} />
        <meshStandardMaterial color="#d97706" roughness={1.0} />
      </mesh>
      {/* A hair further forward than the other peak, so their two faces are not on one plane. */}
      <mesh position={[-0.3, -0.34, canvasFrontZ + 0.01]} rotation={[Math.PI / 2, Math.PI + 0.12, 0]}>
        <cylinderGeometry args={[0, 0.32, 0.001, 3]} />
        <meshStandardMaterial color="#b45309" roughness={1.0} />
      </mesh>
    </group>
  );
}

function WallShelfModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale} position={[0, 0.6, 0]}>
      {/* Wooden shelf board */}
      <mesh castShadow>
        <boxGeometry args={[2.0, 0.06, 0.4]} />
        <meshStandardMaterial color="#b45309" roughness={0.8} />
      </mesh>
      {/* Left bracket */}
      <mesh position={[-0.8, -0.12, -0.1]} castShadow>
        {/* 0.18 deep, not 0.2: at 0.2 the bracket's back face landed on exactly
            the same plane as the shelf board's, which z-fights. */}
        <boxGeometry args={[0.04, 0.24, 0.18]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Right bracket */}
      <mesh position={[0.8, -0.12, -0.1]} castShadow>
        {/* 0.18 deep, not 0.2: at 0.2 the bracket's back face landed on exactly
            the same plane as the shelf board's, which z-fights. */}
        <boxGeometry args={[0.04, 0.24, 0.18]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* A small potted plant with hanging visual vines */}
      <group position={[-0.5, 0.16, 0.05]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.1, 0.08, 0.16, 12]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.6} />
        </mesh>
        {/* Little plant dome */}
        <mesh position={[0, 0.09, 0]}>
          <sphereGeometry args={[0.11, 8, 8]} scale={[1, 0.5, 1]} />
          <meshStandardMaterial color="#22c55e" roughness={0.9} />
        </mesh>
        {/* Vines hanging down shelf */}
        <mesh position={[0, -0.18, 0.1]} castShadow>
          <boxGeometry args={[0.04, 0.3, 0.02]} />
          <meshStandardMaterial color="#15803d" />
        </mesh>
        <mesh position={[0.06, -0.22, 0.1]} castShadow>
          <boxGeometry args={[0.03, 0.2, 0.02]} />
          <meshStandardMaterial color="#166534" />
        </mesh>
      </group>
      {/* Minimalist standing books */}
      <group position={[0.2, 0.22, 0.0]}>
        <mesh rotation={[0, 0.1, 0]} castShadow>
          <boxGeometry args={[0.08, 0.34, 0.24]} />
          <meshStandardMaterial color="#3b82f6" roughness={0.7} />
        </mesh>
        <mesh position={[0.1, -0.02, 0.02]} rotation={[0, -0.15, 0]} castShadow>
          <boxGeometry args={[0.06, 0.3, 0.24]} />
          <meshStandardMaterial color="#ec4899" roughness={0.7} />
        </mesh>
        <mesh position={[0.2, -0.06, 0.04]} rotation={[0, 0, -0.3]} castShadow>
          <boxGeometry args={[0.07, 0.28, 0.22]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

function PaintCanModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale} position={[0, 0.2, 0]}>
      {/* Main can base */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.22, 0.4, 16]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.4} metalness={0.8} />
      </mesh>
      {/* Lid on top */}
      <mesh position={[0, 0.21, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.03, 16]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.2} metalness={0.9} />
      </mesh>
      {/* Spilled color detail or paint splash. A disc lying on the lid, so it
          is a decal and takes the shared bias - its top face is only 5mm above
          the lid's and both are visible, which is inside the depth resolution
          available on a 16-bit interior depth buffer. */}
      <mesh position={[0, 0.225, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.01, 16]} />
        <meshStandardMaterial color="#22c55e" roughness={0.8} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/* Can Handle wire */}
      <mesh position={[0, 0.15, 0]} rotation={[0, 0, Math.PI / 4]}>
        <torusGeometry args={[0.24, 0.015, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#475569" metalness={0.9} />
      </mesh>
    </group>
  );
}

function EntrywayTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Table top */}
      <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.06, 0.5]} />
        <meshStandardMaterial color="#dfc39a" roughness={0.8} />
      </mesh>
      {/* Legs */}
      {[-0.6, 0.6].map((lx, lIdx) =>
        [-0.18, 0.18].map((lz, zIdx) => (
          <mesh key={`leg-${lIdx}-${zIdx}`} position={[lx, 0.35, lz]} castShadow>
            <boxGeometry args={[0.05, 0.7, 0.05]} />
            <meshStandardMaterial color="#b45309" roughness={0.9} />
          </mesh>
        ))
      )}
      {/* Tiny cute empty leaf pot */}
      <group position={[0.2, 0.76, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.08, 0.06, 0.1, 10]} />
          <meshStandardMaterial color="#e5e5e5" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.12, 0]} rotation={[0.5, 0.2, 0]} castShadow>
          <sphereGeometry args={[0.08, 8, 8]} scale={[1, 0.2, 1.8]} />
          <meshStandardMaterial color="#166534" roughness={0.9} />
        </mesh>
      </group>
      {/* Cute minimal vase */}
      <mesh position={[-0.3, 0.82, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.07, 0.18, 12]} />
        <meshStandardMaterial color="#d1fae5" roughness={0.2} opacity={0.8} transparent />
      </mesh>
    </group>
  );
}

/**
 * 寵物窩 — a woven basket with a cushion in it and a shallow bowl beside it.
 *
 * The one piece of furniture in this file whose shape is answerable to something outside itself:
 * an animal walks over and lies down here, so the cushion has to be big enough to hold one. A
 * mammal companion stands ~0.81 world units tall (constants/pets.ts's PET_HEIGHT through
 * AVATAR_BASE_SCALE), and the basket below is ~1.1 across once this BUILDING-category scale is
 * applied — a curled-up dog with room around it, rather than a saucer it perches on.
 *
 * Deliberately low and open. A covered kennel would hide the animal at exactly the moment the whole
 * feature is trying to SHOW the player something ('牠躲在窩裡' has to be visible from the path), and
 * the improvised nest it replaces is a flat mat, so the silhouette stays recognisably the same
 * object the player already knows.
 *
 * Static: no `useFrame`, no interaction trigger, no light. It is somewhere to be, not something to
 * press — the pet's own behaviour layer is what makes it look alive (Three/IslandPet.tsx).
 */
function PetBedModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* The woven rim. A torus rather than a ring of staves: at this size the weave reads as a
          silhouette, and the staves would be sub-pixel from any normal camera distance. */}
      <mesh position={[0, 0.11, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[0.42, 0.075, 8, 20]} />
        <meshStandardMaterial color="#c0965f" roughness={0.9} />
      </mesh>
      {/* The basket wall under the rim, so the bed has a body rather than being a floating hoop. */}
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.44, 0.4, 0.12, 20, 1, true]} />
        <meshStandardMaterial color="#a97c48" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Two weave courses round the wall, the same two 藤編狗籃 has. A single untextured cone of
          wall reads as a plastic tub; two darker bands across it read as willow. */}
      {[0.035, 0.09].map((y) => (
        <mesh key={`course-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.425, 0.014, 6, 20]} />
          <meshStandardMaterial color="#8a6538" roughness={0.95} />
        </mesh>
      ))}
      {/* The cushion. Domed and inset, so it reads as padding sitting inside the basket rather
          than as a lid across the top of it. */}
      <mesh position={[0, 0.085, 0]} scale={[1, 0.42, 1]} castShadow receiveShadow>
        <sphereGeometry args={[0.38, 16, 10]} />
        <meshStandardMaterial color="#e8ddc8" roughness={0.95} />
      </mesh>
      {/* The seam across the cushion — one line of stitching is what separates 'a cushion' from
          'a beige dome'. */}
      <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.225, 20]} />
        <meshStandardMaterial color="#cfc0a4" roughness={0.95} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/* The bowl, in the same teal the improvised nest's is (Three/IslandOvergrowth.tsx) so the
          bought bed and the scruffy one the game draws for free are plainly the same idea. */}
      {/* Two bowls, food and water, in the same teal. One bowl beside a bed reads as a prop that
          came with the render; a PAIR reads as somewhere an animal is actually kept — and the
          second one costs nothing in footprint, because it tucks in behind the first. */}
      {([[0.14, '#e8c98a'], [-0.16, '#7fd2e8']] as [number, string][]).map(([z, fill], i) => (
        <group key={`bowl-${i}`} position={[0.62, 0, z]}>
          <mesh position={[0, 0.05, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.11, 0.1, 12]} />
            <meshStandardMaterial color="#5fbdaf" roughness={0.7} />
          </mesh>
          {/* 碗裡的東西。改版前擺在 y = 0.098，也就是碗口（0.10）下面 2mm —— 碗是一個實心的
              圓錐，所以那片圓盤整個埋在碗裡看不見，同時兩個朝上的面只差 2mm，`audit:zfighting`
              一直在報這一對。放到碗口平面上、宣告成 decal，才是它本來要表達的東西：碗口留一圈
              0.035 的邊，中間是食物或水。 */}
          <mesh position={[0, 0.10, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.115, 12]} />
            <meshStandardMaterial color={i === 0 ? '#1f7a70' : fill} roughness={0.9} {...DECAL_DEPTH_BIAS} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* --- 寵物休息處 ---------------------------------------------------------------------------- */

/**
 * The nine homes below are one family, and this palette is what makes them read that way.
 *
 * They are sold across three species' shelves and will never be seen side by side in the world, so
 * the thing holding them together has to be the material vocabulary rather than the silhouette:
 * warm pine, weathered willow, cream canvas, and the same island teal for every food and water
 * bowl (the colour the improvised nest's bowl and 戶外寵物窩's already use — see PetBedModel).
 *
 * Everything here is BUILDING category, so `scale` arrives as 0.85 × 1.55 ≈ 1.32. Local units below
 * are therefore ~0.76 of a world unit, which is what the perch heights are measured back through:
 * 樹枝鳥架's fork sits at local 0.97 to land a bird at the 1.28 its catalog row declares
 * (constants/items.ts). Those two numbers have to agree or the bird perches in mid-air — the model
 * is the picture and the catalog is where the animal actually goes.
 *
 * All nine are static. A resting place is somewhere to be, not something to press: what makes them
 * look alive is the animal walking or flying over to one (Three/IslandPet.tsx).
 */
const PET_WOOD = '#C08B52';
const PET_WOOD_DARK = '#98673A';
const PET_WILLOW = '#C7A472';
const PET_CANVAS = '#EFE4CE';
const PET_CUSHION = '#E8DDC8';
const PET_BOWL = '#5FBDAF';
const PET_SHADOW = '#4A3524';

/** The dark mouth of a doorway or a cage — one colour, so every opening reads as the same depth. */
const PET_OPENING = '#3A2A1C';

/** 木製小狗屋 — planked walls, a gabled roof, an arched door with straw showing through it. */
function PetDogCabinModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Walls. */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.56, 0.78]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} />
      </mesh>
      {/*
        Two plank grooves, which is all it takes to say 「一片片釘起來的」 at this size.

        They used to be flat strips on the FRONT face only (`position=[0, y, 0.4]`), which is the
        one face the shop icon shows — so the picture promised a plank-built cabin and the model
        delivered one from the front and a plain brown box from either side and from behind. On the
        island a doghouse is walked around, not looked at head-on.

        The fix is not four times as many strips: each groove is now a thin BAND wrapping the whole
        body — one mesh that is slightly wider and deeper than the walls, so it shows on all four
        faces at once. Two meshes, same as before, four times the coverage.
      */}
      {[0.16, 0.4].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[0.872, 0.022, 0.792]} />
          <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.95} />
        </mesh>
      ))}
      {/*
        The gable, as a 3-sided prism — a proper pitched roof from one primitive.

        `rotation={[-PI/2, 0, 0]}` and not a rotation about Z: a cylinder's first vertex sits at +z,
        so tipping it about Z leaves that vertex pointing sideways and the roof reads as a flat
        slab (which is exactly what it did). Tipping about X puts the vertex at +y, which is where
        a ridge goes, and lays the prism's length along z so the triangular faces are the front and
        back gables — the shape a doghouse is recognised by, with the door in one of them.

        `scale` flattens the cross-section, and it has to be the Z component: scale is applied
        before rotation, so the axis that ends up vertical is the geometry's own z. An equilateral
        prism is a 60° roof, which on a body this squat looks like a witch's hat.
      */}
      <mesh
        position={[0, 0.703, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1, 1, 0.55]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.52, 0.52, 0.94, 3]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.85} />
      </mesh>
      {/*
        The doorway. Arched rather than square: a rounded opening is the one shape that says
        「狗屋」 rather than 「木箱」 in silhouette.

        Drawn FLAT against the wall — a panel and a half-round over it — rather than as a capsule
        pushed into the face, which is what it was. A capsule is a 3D pill, so the front half of it
        stood proud of the wall and the doghouse wore a large dark egg. Two thin shapes barely
        clearing the plank face read as a hole, cost nothing, and cannot bulge.
      */}
      {/* Its foot stops a hair above the ground rather than ON it: the walls' own base is at y=0,
          and two faces in the same plane is what `npm run audit:placements` calls a coplanar pair. */}
      <mesh position={[0, 0.145, 0.392]}>
        <boxGeometry args={[0.3, 0.27, 0.03]} />
        <meshStandardMaterial color={PET_OPENING} roughness={1} />
      </mesh>
      <mesh position={[0, 0.28, 0.3925]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.152, 0.152, 0.026, 14]} />
        <meshStandardMaterial color={PET_OPENING} roughness={1} />
      </mesh>
      {/* Straw spilling out over the threshold, which is where the animal actually lies — see the
          `offset` on this item's catalog row. */}
      <mesh position={[0, 0.02, 0.44]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.2, 12]} />
        <meshStandardMaterial color="#DBBE7C" roughness={1} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/* The name plaque under the eaves. Blank — it is the player's dog, not ours. */}
      <mesh position={[0, 0.52, 0.4]} castShadow>
        <boxGeometry args={[0.3, 0.11, 0.02]} />
        <meshStandardMaterial color="#E8CF9C" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 帆布帳篷窩 — a canvas A-frame on two poles, flaps tied back. */
function PetDogTentModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* The canvas, a 3-sided prism like the cabin's roof but reaching the ground — which is what
          a tent IS, and it keeps the two dog homes plainly different in silhouette. Same rotation
          reasoning as the cabin above, and unflattened: a tent really is that steep. */}
      <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.9, 3]} />
        <meshStandardMaterial color={PET_CANVAS} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* The dark interior — the same triangle, smaller, pushed out through the front so the tent
          reads as open rather than as a closed wedge. */}
      <mesh position={[0, 0.17, 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.12, 3]} />
        <meshStandardMaterial color={PET_OPENING} roughness={1} />
      </mesh>
      {/*
        Two canvas stripes running down both slopes.

        The shop icon's tent is BANDED — light canvas with darker courses across it — and that
        banding is doing real work: the model's canvas is one 3-sided prism, so from either side
        the player sees a single unbroken sloped rectangle and the tent reads as a folded sheet.
        A stripe is one thin prism, slightly larger than the canvas, wrapping both slopes at once
        for one draw call, and it gives that big blank face a horizontal to read against.
      */}
      {/*
        帳篷的三角形斷面：頂點 (0, 0.75)、底角 (±0.433, 0)，所以斜面方向是 (±0.5, −0.866)，
        法線是 (±0.866, 0.5)。帶子要**貼著斜面躺**，不是橫穿過去 —— 一根水平的橫桿只有兩個
        端點會從斜面透出來，中間整段都埋在帆布裡（第一版就是這樣，側面看起來還是一片空白）。
        所以每一條帶子繞 z 轉 ∓60° 對齊斜面，再沿法線推出 1.4 公分浮在布面上。
      */}
      {([-1, 1] as const).flatMap((s) =>
        [0.35, 0.68].map((u) => (
          <mesh
            key={`stripe-${s}-${u}`}
            position={[s * (0.433 * u + 0.866 * 0.014), 0.75 * (1 - u) + 0.5 * 0.014, 0]}
            rotation={[0, 0, s > 0 ? -Math.PI / 3 : -(Math.PI * 2) / 3]}
            castShadow
          >
            <boxGeometry args={[0.26, 0.022, 0.90]} />
            <meshStandardMaterial color="#C9B48C" roughness={0.95} />
          </mesh>
        ))
      )}
      {/* The two tied-back flaps, following the slope of the canvas they were peeled off. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.3, 0.2, 0.46]} rotation={[0, 0, side * 0.52]} castShadow>
          <boxGeometry args={[0.13, 0.4, 0.03]} />
          <meshStandardMaterial color="#E2D2B4" roughness={0.95} />
        </mesh>
      ))}
      {/* Ridge pole ends sticking out at both gables — the detail that makes it a tent someone
          pitched rather than a folded sheet. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.74, side * 0.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.16, 6]} />
          <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* The ridge seam, straddling the prism's top edge. A canvas tent is two panels sewn
          together along the top, and that seam is the one line that says so. */}
      <mesh position={[0, 0.735, 0]} castShadow>
        <boxGeometry args={[0.055, 0.045, 0.92]} />
        <meshStandardMaterial color="#D8C7A6" roughness={0.95} />
      </mesh>
      {/* Two pegs holding the front corners down. Small, but they are the difference between a
          tent someone pitched and a canvas shape resting on the grass. */}
      {[-1, 1].map((side) => (
        <mesh key={`peg-${side}`} position={[side * 0.40, 0.05, 0.44]} rotation={[Math.PI, 0, side * 0.2]} castShadow>
          <coneGeometry args={[0.032, 0.10, 5]} />
          <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {/* A rolled mat inside the doorway. */}
      <mesh position={[0, 0.05, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 14]} />
        <meshStandardMaterial color="#C9BFA6" roughness={1} {...DECAL_DEPTH_BIAS} />
      </mesh>
    </group>
  );
}

/** 藤編狗籃 — a long low willow basket with a faded checked blanket in it. */
function PetDogBasketModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Oval, and that is the whole difference from 戶外寵物窩's round basket: a dog lies out
          straight, and a long basket says so from any angle. */}
      <mesh position={[0, 0.09, 0]} scale={[1.35, 1, 1]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.38, 0.18, 20, 1, true]} />
        <meshStandardMaterial color={PET_WILLOW} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* The rim, scaled to the same oval so it sits on the wall rather than beside it. */}
      <mesh position={[0, 0.17, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.35, 1, 1]} castShadow>
        <torusGeometry args={[0.41, 0.055, 8, 22]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} />
      </mesh>
      {/* Three weave courses. */}
      {[0.045, 0.09, 0.135].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.35, 1, 1]}>
          <torusGeometry args={[0.4, 0.014, 6, 20]} />
          <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.95} />
        </mesh>
      ))}
      {/* The blanket, domed inside the basket. */}
      <mesh position={[0, 0.12, 0]} scale={[1.3, 0.3, 0.95]} castShadow>
        <sphereGeometry args={[0.36, 16, 10]} />
        <meshStandardMaterial color="#D9D2C4" roughness={1} />
      </mesh>
      {/* Two check lines on it — the pattern is what stops the blanket reading as more basket. */}
      {[-0.14, 0.14].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.03, 0.5]} />
          <meshStandardMaterial color="#B9AE99" roughness={1} {...DECAL_DEPTH_BIAS} />
        </mesh>
      ))}
      {/* A woven handle loop at each end. Turned a quarter about Y so the arch stands across the
          basket's short axis, and set at ±0.46 so it stays inside the oval's own 0.567 half-width
          — a handle that stuck out would widen what the player has to leave clear around it. */}
      {[-0.46, 0.46].map((x) => (
        <mesh key={`handle-${x}`} position={[x, 0.185, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.075, 0.021, 5, 12, Math.PI]} />
          <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** 圓形貓窩 — a cream doughnut with a dip in the middle. */
function PetCatDonutModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* The rim IS the object: a fat torus, thicker relative to its radius than any dog bed here,
          because a cat bed is a wall you disappear behind rather than a mat you lie on. */}
      {/* The doughnut itself. A shade warmer than the dish and the loose cushion inside it: the
          shop icon draws this bed as three CONCENTRIC TONES (rim / dish / cushion) and that is the
          only thing separating it from a plain white ring at card size — the model had rim and
          cushion within a hair of each other, so on the island it read as one uniform blob. */}
      <mesh position={[0, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[0.33, 0.16, 10, 22]} />
        <meshStandardMaterial color="#D3C0A0" roughness={1} />
      </mesh>
      {/* The dished floor inside it. */}
      <mesh position={[0, 0.09, 0]} scale={[1, 0.35, 1]} receiveShadow>
        <sphereGeometry args={[0.33, 18, 10]} />
        <meshStandardMaterial color="#D6C8AE" roughness={1} />
      </mesh>
      {/* A quilted seam around the rim — one line, which is all that survives the shrink. */}
      <mesh position={[0, 0.24, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.325, 22]} />
        <meshStandardMaterial color="#C6B69A" roughness={1} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/*
        A base pad under the doughnut, four quilting ribs across the rim, and a loose cushion in
        the dish. This was the leanest thing on the island at three primitives — a torus, a dished
        sphere and a painted ring — and it showed: a plain torus is a swim ring, and no amount of
        colour makes it read as something stuffed.

        The ribs sit at y=0.30, one centimetre PROUD of the torus's own 0.31 top, because a rib
        buried inside the cushion it is quilting is a rib nobody sees.
      */}
      <mesh position={[0, 0.022, 0]} receiveShadow>
        <cylinderGeometry args={[0.44, 0.46, 0.045, 16]} />
        <meshStandardMaterial color="#C6B69A" roughness={1} />
      </mesh>
      {/*
        絎縫。改版前是四根**放射**的長條（長 0.30、擺在半徑 0.33 上，也就是從 r=0.18 橫跨到
        r=0.48），高度 0.30 又剛好卡在torus 頂面 0.31 底下一公分 —— 結果四根白條從圓弧面上穿
        出來，遠看像四根插在甜甜圈上的骨頭。商店縮圖畫的是三圈**同心**的色環，這件商品的識別
        就是那三圈；放射線不是它。

        兩圈同心環取代四根放射條：更接近縮圖，而且少兩個 mesh。
      */}
      {([[0.215, 0.250, '#EFE7D6'], [0.285, 0.325, '#DED2BB'], [0.395, 0.440, '#C6B69A']] as const).map(([r0, r1, colour]) => (
        <mesh key={`quilt-${r0}`} position={[0, 0.302, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r0, r1, 22]} />
          <meshStandardMaterial color={colour} roughness={1} {...DECAL_DEPTH_BIAS} />
        </mesh>
      ))}
      <mesh position={[0, 0.115, 0]} scale={[1, 0.28, 1]} castShadow receiveShadow>
        <sphereGeometry args={[0.26, 14, 9]} />
        <meshStandardMaterial color="#EFE7D6" roughness={1} />
      </mesh>
    </group>
  );
}

/** 毛線貓屋 — a coiled-wool dome with a round door and a loose ball on top. */
function PetCatYarnModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* The dome. */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.42, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#D8B9A8" roughness={1} />
      </mesh>
      {/* Three coils of wool wrapped round it. Rings rather than a spiral: a real spiral costs a
          custom geometry and reads identically at this size. */}
      {[
        { y: 0.1, r: 0.405 },
        { y: 0.175, r: 0.385 },
        { y: 0.24, r: 0.345 },
        { y: 0.35, r: 0.235 },
      ].map((coil) => (
        <mesh key={coil.y} position={[0, coil.y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[coil.r, 0.035, 6, 20]} />
          <meshStandardMaterial color="#C79E8A" roughness={1} />
        </mesh>
      ))}
      {/* The door — half-open, so this reads as 「半封閉」 rather than as a sealed igloo. */}
      <mesh position={[0, 0.14, 0.395]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.17, 0.17, 0.06, 14]} />
        <meshStandardMaterial color={PET_OPENING} roughness={1} />
      </mesh>
      {/* The wool bound round the doorway. Every knitted opening has one, and without it the door
          is a hole punched through the coils rather than an opening they were wound around. */}
      <mesh position={[0, 0.14, 0.385]} castShadow>
        <torusGeometry args={[0.185, 0.032, 6, 14]} />
        <meshStandardMaterial color="#B9857A" roughness={1} />
      </mesh>
      {/* The unfinished ball of yarn on the roof, with its loose end. */}
      <mesh position={[0.13, 0.44, -0.06]} castShadow>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshStandardMaterial color="#B9857A" roughness={1} />
      </mesh>
      <mesh position={[0.2, 0.36, -0.02]} rotation={[0.4, 0, 0.9]}>
        <torusGeometry args={[0.07, 0.014, 6, 14, Math.PI]} />
        <meshStandardMaterial color="#B9857A" roughness={1} />
      </mesh>
    </group>
  );
}

/**
 * 木製貓跳台 — a rope-wrapped post under a sunny platform, with a cubby underneath.
 *
 * The CUBBY is where the animal actually settles (the catalog row's `petRest` has no height — see
 * constants/items.ts on why a raised sleeping spot would be one the cat can never reach in a game
 * with no climbing). The platform on top is what makes it a cat tower to look at.
 */
function PetCatTowerModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Base. */}
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.76, 0.06, 0.66]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/*
        The cubby, as ONE solid block with a dark mouth pushed into its front face.

        It was built as a shell of four boxes first — back wall, two side walls, roof — which is the
        obvious way to make a box with a hole in it and is the wrong way here: walls that meet share
        exact faces, and `npm run audit:placements` reported seven coplanar pairs on this model
        alone. Two boxes cannot z-fight if no face of one lies in the plane of a face of the other,
        which is what every extent below is chosen to guarantee. The mouth deliberately protrudes a
        hair past the front face rather than sitting flush in it, for the same reason.
      */}
      <mesh position={[0, 0.2, -0.06]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.3, 0.4]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.195, 0.06]}>
        <boxGeometry args={[0.4, 0.22, 0.2]} />
        <meshStandardMaterial color={PET_OPENING} roughness={1} />
      </mesh>
      <mesh position={[0, 0.37, -0.05]} castShadow receiveShadow>
        <boxGeometry args={[0.66, 0.05, 0.46]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* The post, wrapped in sisal — the one detail that says 貓 rather than 層架. Its ends run
          INTO the roof below it and the platform above it, so neither joint is a shared face. */}
      <mesh position={[0, 0.605, -0.08]} castShadow>
        <cylinderGeometry args={[0.075, 0.075, 0.44, 12]} />
        <meshStandardMaterial color="#CDB58A" roughness={1} />
      </mesh>
      {[0.46, 0.56, 0.66, 0.76].map((y) => (
        <mesh key={y} position={[0, y, -0.08]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.077, 0.012, 6, 14]} />
          <meshStandardMaterial color="#B69C71" roughness={1} />
        </mesh>
      ))}
      {/* The sunning platform. */}
      <mesh position={[0, 0.84, -0.08]} castShadow receiveShadow>
        <cylinderGeometry args={[0.31, 0.31, 0.05, 18]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.868, -0.08]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 18]} />
        <meshStandardMaterial color={PET_CUSHION} roughness={1} {...DECAL_DEPTH_BIAS} />
      </mesh>
    </group>
  );
}

/**
 * 木製鳥籠 — a domed cage on a foot, door permanently open, a perch across the middle.
 *
 * The perch bar sits at local 0.8 with a radius of 0.026, so its upper SURFACE is at 0.826 — the
 * 1.09 world units the catalog declares for this item (× 1.3175). A bird settling here puts its FEET
 * on that surface: `restingHeight` (Three/IslandPet.tsx) positions the model's origin, and every
 * animal in Pets.tsx is built upward from y=0 at its feet. So the two numbers are one measurement
 * written in two places and must be changed together — and it is the surface, never the axis, or
 * the bird sinks into the bar by its radius.
 */
/** The top of the bars, where the rim ring sits and the dome meets it. */
const BIRD_CAGE_RIM_Y = 1.23;
/** How much of the sphere the dome is, from its pole down — 75°. */
const BIRD_CAGE_DOME_ARC = Math.PI / 2.4;
function PetBirdCageModel({ scale }: FurnitureModelProps) {
  const bars = 12;
  return (
    <group scale={scale}>
      {/* Foot and base tray. */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.26, 0.1, 14]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 0.52, 10]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.34, 0.06, 18]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} />
      </mesh>
      {/* The bars. Wood, not wire: 「避免寫實金屬籠」 is the brief's own note, and warm dowels are
          what keep this on the same shelf as a willow basket. */}
      {Array.from({ length: bars }, (_, i) => {
        const a = (i / bars) * Math.PI * 2;
        // A quarter turn is left out at the front — that gap IS the open door.
        if (a > 1.15 && a < 2.0) return null;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.3, 0.95, Math.cos(a) * 0.3]} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.56, 5]} />
            <meshStandardMaterial color={PET_WILLOW} roughness={0.9} />
          </mesh>
        );
      })}
      {/* Rim and dome, so the bars are held top and bottom.

          The dome is a CAP — the top 75° of a sphere — so its lower edge is not at the sphere's
          centre but `cos(75°)·r` above it. It used to be centred at the rim's own height, which put
          that edge 6 cm above the rim: daylight between the roof and the cage, and the hanging ring
          (1.42) buried inside the dome instead of standing on it. Centring the sphere that far
          BELOW the rim seats the cap's edge on the ring, and the cap's edge radius (0.29) on the
          ring's (0.30). */}
      <mesh position={[0, BIRD_CAGE_RIM_Y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.3, 0.026, 6, 20]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} />
      </mesh>
      <mesh position={[0, BIRD_CAGE_RIM_Y - 0.3 * Math.cos(BIRD_CAGE_DOME_ARC), 0]} castShadow>
        <sphereGeometry args={[0.3, 18, 8, 0, Math.PI * 2, 0, BIRD_CAGE_DOME_ARC]} />
        <meshStandardMaterial color={PET_WOOD} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* The ring it hangs from. */}
      <mesh position={[0, 1.42, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.055, 0.014, 6, 12]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* The perch — where the bird actually lands. See the doc above. */}
      <mesh position={[0, 0.8, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.026, 0.026, 0.5, 8]} />
        <meshStandardMaterial color={PET_SHADOW} roughness={0.95} />
      </mesh>
      {/* Two little bowls on the tray, in the island teal every food bowl in the game uses. */}
      {[-0.17, 0.17].map((x) => (
        <mesh key={x} position={[x, 0.72, 0.06]} castShadow>
          <cylinderGeometry args={[0.075, 0.055, 0.07, 10]} />
          <meshStandardMaterial color={PET_BOWL} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** 樹枝鳥架 — a piece of driftwood in a round base, with one branch worn smooth. */
function PetBirdPerchModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.34, 0.08, 18]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* The trunk, leaning a little — driftwood is never straight, and the lean is most of what
          separates this from a lamp post. */}
      <mesh position={[0, 0.52, 0]} rotation={[0, 0, 0.08]} castShadow>
        <cylinderGeometry args={[0.055, 0.075, 0.9, 8]} />
        <meshStandardMaterial color="#A87F53" roughness={1} />
      </mesh>
      {/* The fork the bird lands on. Its upper surface is at local 0.97 + 0.042 — the 1.33 world
          units the catalog declares. See the cage above on why it is the surface, not the axis. */}
      <mesh position={[0.12, 0.97, 0]} rotation={[0, 0, Math.PI / 2 - 0.12]} castShadow>
        <cylinderGeometry args={[0.036, 0.042, 0.46, 8]} />
        <meshStandardMaterial color="#C29A6B" roughness={0.85} />
      </mesh>
      {/* A second twig going the other way, so the fork reads as a branching point. */}
      <mesh position={[-0.14, 0.82, 0.06]} rotation={[0.3, 0, -1.1]} castShadow>
        <cylinderGeometry args={[0.024, 0.032, 0.3, 6]} />
        <meshStandardMaterial color="#A87F53" roughness={1} />
      </mesh>
      {/* Bark still on the lower trunk — three rings, which is enough texture at this scale. */}
      {[0.24, 0.4, 0.56].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.068, 0.011, 5, 12]} />
          <meshStandardMaterial color="#8E6941" roughness={1} />
        </mesh>
      ))}
      {/* A leaf sprig, because a bare stick in a pot reads as unfinished. */}
      <mesh position={[-0.24, 0.92, 0.1]} rotation={[0.5, 0.3, 0.4]} scale={[1, 0.25, 1.7]} castShadow>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#7FA361" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** 手作鳥巢 — a woven bowl on a forked stand, stuffed with cotton. */
function PetBirdNestModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.28, 0.07, 16]} />
        <meshStandardMaterial color={PET_WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* The stand — a short fork rather than a post, so the nest looks CRADLED rather than
          screwed on. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.07, 0.32, 0]} rotation={[0, 0, -side * 0.2]} castShadow>
          <cylinderGeometry args={[0.028, 0.038, 0.52, 7]} />
          <meshStandardMaterial color="#A87F53" roughness={1} />
        </mesh>
      ))}
      {/* The nest bowl. The bird sits down INTO this rather than on it, so the height the catalog
          declares (0.88 world) is the COTTON at local ~0.67 — which leaves the rim at local 0.71
          sitting around its body, and that is what makes it read as sitting in a nest. */}
      <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.19, 0.2, 18, 1, true]} />
        <meshStandardMaterial color={PET_WILLOW} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.53, 0]} castShadow>
        <cylinderGeometry args={[0.19, 0.19, 0.03, 16]} />
        <meshStandardMaterial color="#B08F5F" roughness={1} />
      </mesh>
      {/* The rim, deliberately lumpy-looking through a low segment count — this one is 「做得不太
          整齊，但很暖」 and a perfectly smooth torus would be a factory basket. */}
      <mesh position={[0, 0.71, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.29, 0.05, 5, 13]} />
        <meshStandardMaterial color="#D0AC77" roughness={1} />
      </mesh>
      {/* Cotton lining, kept clear of the weave around it.
          At r=0.25 its equator met the tapering wall almost exactly and poked through as a ring of
          white scallops — the bowl's radius at that height is ~0.25 too. It has to be measured
          against the CONE, not against the rim. */}
      <mesh position={[0, 0.645, 0]} scale={[1, 0.4, 1]}>
        <sphereGeometry args={[0.2, 14, 10]} />
        <meshStandardMaterial color="#F3EADA" roughness={1} />
      </mesh>
      {/* A few straws sticking out of the weave. */}
      {[0.6, 2.1, 4.3].map((a) => (
        <mesh
          key={a}
          position={[Math.sin(a) * 0.3, 0.74, Math.cos(a) * 0.3]}
          rotation={[0.5, a, 0.4]}
          castShadow
        >
          <cylinderGeometry args={[0.008, 0.008, 0.16, 4]} />
          <meshStandardMaterial color="#DBBE7C" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/* ==================================================================================
 *                              THE 2026-09 FURNITURE EXPANSION
 *
 * Everything below is new. Two rules held throughout, and they are the reason the pieces are
 * worth having rather than just numerous:
 *
 *  1. **Difference is in the SILHOUETTE, not the scale.** 小圓桌, 方形餐桌, 長型餐桌, 圓形茶几,
 *     藤編邊桌, 折疊露營桌, 柚木戶外桌 and 松木工作桌 are eight tables with eight different leg
 *     systems (pedestal, splayed taper, trestle, hairpin hoop, woven cone, X-frame, cross-brace,
 *     square post) and five different tops. None of them is another one at another `scale`.
 *  2. **Three layers, low poly.** A main structure, a secondary structure that says how it is
 *     BUILT (aprons, stretchers, panel frames, plinths), and two or three small things that say
 *     it is LIVED IN (a folded blanket, a mug, a leaning book, a sprig in a jar). Detail comes
 *     from dividing volume, not from raising segment counts — every curve here is 6–16 segments.
 *
 * Sizes are never typed anywhere else: colliders, walk heights and tabletop surfaces are all
 * measured off these components (lib/furniturePlacement.ts). The ONE hand-typed number a piece
 * can carry is its seat/lie anchor in constants/items.ts, and `npm run audit:interactions` puts
 * the character on every one of them and checks where the body lands.
 * ================================================================================== */

/* ------------------------------------------------------------------- 客廳 · 沙發與椅子 */

/**
 * The tub's open front, as an arc of angle round its axis (`a`, with x = cos a and z = sin a — the
 * front is a = PI/2). The staves are left out across it and the hoops stop at its edges, so the two
 * agree by construction.
 *
 * 80° wide — five staves — rather than the three it used to leave out. The opening is where the
 * sitter's body comes out of the tub (the hips sit at the seat's front edge, see
 * lib/occupantFit.ts), and at the rim's radius a three-stave gap is 0.49 wide against a body 0.62
 * across: the rim ran through the sitter's sides. Measured, not judged — `npm run
 * audit:interactions`.
 */
const RATTAN_OPENING = { start: (50 * Math.PI) / 180, end: (130 * Math.PI) / 180 } as const;

/** 藤編單人沙發 — 海島系列. An open rattan tub chair with a cushion dropped into it. */
function RattanArmchairModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Four splayed legs. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.36, 0.16, sz * 0.34]} rotation={[sz * 0.1, 0, -sx * 0.1]} castShadow>
          <cylinderGeometry args={[0.035, 0.045, 0.32, 6]} />
          <meshStandardMaterial color="#a3773f" roughness={0.9} />
        </mesh>
      )))}
      {/* Woven tub — a dense ring of staves leaning outward, which is the whole silhouette.
          24 of them rather than 16, and wider than the gap between them, so the weave reads as
          basketry rather than as a picket fence. */}
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        // Only the narrow front is left open, so the seat is visible from the room side without
        // the tub losing its shape.
        if (a > RATTAN_OPENING.start && a < RATTAN_OPENING.end) return null;
        return (
          <mesh
            key={`stave-${i}`}
            position={[Math.cos(a) * 0.47, 0.475, Math.sin(a) * 0.45]}
            rotation={[-Math.sin(a) * 0.16, -a, Math.cos(a) * 0.16]}
            castShadow
          >
            <boxGeometry args={[0.045, 0.53, 0.135]} />
            <meshStandardMaterial color={i % 2 ? '#cfa96b' : '#bd9557'} roughness={0.95} />
          </mesh>
        );
      })}
      {/* Three hoops binding the staves — the weave reading. The rim stops at 0.74, low enough
          that the seat inside is visible from a standing camera; a taller tub reads as a barrel.

          They stop where the staves stop. They used to run the full circle, so the top two hoops
          crossed the open front at thigh and waist height — a bar straight across the doorway of a
          chair whose whole point is that it is open at the front, and one that anybody sitting in
          it passed through (`npm run audit:interactions`: 3 cm). The arc skips the same angles the
          staves skip; see RATTAN_OPENING. */}
      {[0.26, 0.5, 0.72].map((y) => (
        <mesh key={`hoop-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, RATTAN_OPENING.end]} castShadow>
          <torusGeometry args={[0.485, 0.028, 6, 20, Math.PI * 2 - (RATTAN_OPENING.end - RATTAN_OPENING.start)]} />
          <meshStandardMaterial color="#a8834b" roughness={0.95} />
        </mesh>
      ))}
      {/* Seat pad, filling the tub. Deep (0.32–0.50) so a good part of it shows above the lowest
          hoop, and warm enough to read against the floor. Top face local y = 0.50 -> world 0.575,
          which is its `sit.surfaceY`. */}
      <group position={[0, 0.32, 0.02]} ref={anim.ref('cushion')}>
        <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.44, 0.4, 0.18, 14]} />
          <meshStandardMaterial color="#e2d3b6" roughness={0.9} />
        </mesh>
      </group>
      {/* Piping around the pad's edge — the line that separates cushion from basket. */}
      <mesh position={[0, 0.44, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.445, 0.022, 6, 20]} />
        <meshStandardMaterial color="#cbb897" roughness={0.95} />
      </mesh>
      {/* Back cushion, tipped against the staves. */}
      <mesh position={[0, 0.66, -0.31]} rotation={[0.28, 0, 0]} castShadow>
        <boxGeometry args={[0.56, 0.38, 0.14]} />
        <meshStandardMaterial color="#7fa8a0" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** 亞麻雙人沙發 — 簡約系列. Slim linen two-seater on tapered pale legs. */
function LinenLoveseatModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Frame. Seat deck top local y = 0.54 -> world 0.621. */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.62, 0.24, 0.86]} />
        <meshStandardMaterial color="#dcd3c4" roughness={0.9} />
      </mesh>
      {/* Two seat cushions with a visible seam. */}
      {[-0.38, 0.38].map((x, i) => (
        <group key={`seat-${x}`} position={[x, 0.50, 0.02]} ref={anim.ref('cushion', i)}>
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.72, 0.1, 0.78]} />
          <meshStandardMaterial color="#eae3d6" roughness={0.95} />
        </mesh>
        </group>
      ))}
      {/* Low back, and two back cushions leaning on it. */}
      <mesh position={[0, 0.7, -0.36]} rotation={[-0.08, 0, 0]} castShadow>
        <boxGeometry args={[1.6, 0.5, 0.14]} />
        <meshStandardMaterial color="#d4cabb" roughness={0.9} />
      </mesh>
      {[-0.37, 0.37].map((x) => (
        <mesh key={`back-${x}`} position={[x, 0.72, -0.25]} rotation={[-0.16, 0, 0]} castShadow>
          <boxGeometry args={[0.66, 0.36, 0.12]} />
          <meshStandardMaterial color="#eae3d6" roughness={0.95} />
        </mesh>
      ))}
      {/* Thin arms — the detail that separates 簡約 from the fat blue 奢華沙發. */}
      {[-0.79, 0.79].map((x) => (
        <mesh key={`arm-${x}`} position={[x, 0.62, -0.02]} castShadow>
          <boxGeometry args={[0.1, 0.16, 0.8]} />
          <meshStandardMaterial color="#c8bdad" roughness={0.85} />
        </mesh>
      ))}
      {/* Tapered legs, splayed — this is the piece's signature. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.68, 0.15, sz * 0.32]} rotation={[sz * 0.14, 0, -sx * 0.1]} castShadow>
          <cylinderGeometry args={[0.026, 0.042, 0.3, 6]} />
          <meshStandardMaterial color="#b98a52" roughness={0.75} />
        </mesh>
      )))}
      {/* A throw folded over one arm. */}
      <mesh position={[0.62, 0.71, 0.06]} rotation={[0, 0, 0.05]} castShadow>
        <boxGeometry args={[0.3, 0.05, 0.5]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** L 型布沙發 — 簡約系列. Long run plus a chaise return, the only L in the catalog. */
function LShapedSofaModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Main run along x. Seat deck top local y = 0.52 -> world 0.598. */}
      <mesh position={[0, 0.4, -0.35]} castShadow receiveShadow>
        <boxGeometry args={[2.3, 0.24, 1.0]} />
        <meshStandardMaterial color="#8e9aa0" roughness={0.85} />
      </mesh>
      {/* Chaise return along z, coming toward the room off the right end. */}
      <mesh position={[0.78, 0.415, 0.52] } castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.23, 0.76]} />
        <meshStandardMaterial color="#8e9aa0" roughness={0.85} />
      </mesh>
      {/* Seat cushions: three on the run, one on the return. */}
      {[-0.76, 0, 0.76].map((x, i) => (
        <group key={`seat-${x}`} position={[x, 0.46, -0.33]} ref={anim.ref('cushion', i)}>
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.72, 0.1, 0.94]} />
          <meshStandardMaterial color="#a9b5ba" roughness={0.9} />
        </mesh>
        </group>
      ))}
      <mesh position={[0.78, 0.51, 0.53]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.1, 0.72]} />
        <meshStandardMaterial color="#a9b5ba" roughness={0.9} />
      </mesh>
      {/* Back along the run only — a chaise has no back, which is what makes the L read. */}
      <mesh position={[0, 0.72, -0.78]} rotation={[-0.06, 0, 0]} castShadow>
        <boxGeometry args={[2.3, 0.56, 0.14]} />
        <meshStandardMaterial color="#7d8a91" roughness={0.85} />
      </mesh>
      {[-0.76, 0, 0.76].map((x) => (
        <mesh key={`back-${x}`} position={[x, 0.73, -0.67]} rotation={[-0.14, 0, 0]} castShadow>
          <boxGeometry args={[0.7, 0.4, 0.12]} />
          <meshStandardMaterial color="#a9b5ba" roughness={0.9} />
        </mesh>
      ))}
      {/* One arm, on the left end only. */}
      <mesh position={[-1.19, 0.62, -0.35]} castShadow>
        <boxGeometry args={[0.14, 0.44, 0.96]} />
        <meshStandardMaterial color="#7d8a91" roughness={0.85} />
      </mesh>
      {/* Feet. */}
      {[[-1.05, -0.7], [-1.05, 0.0], [1.05, -0.7], [0.5, 0.8], [1.05, 0.8]].map(([x, z], i) => (
        <mesh key={`foot-${i}`} position={[x, 0.13, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.03, 0.26, 6]} />
          <meshStandardMaterial color="#5b6469" roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      {/* Two cushions tossed on the chaise. */}
      <mesh position={[0.72, 0.62, 0.5]} rotation={[0.1, 0.4, 0.2]} castShadow>
        <boxGeometry args={[0.34, 0.12, 0.34]} />
        <meshStandardMaterial color="#d98f7a" roughness={0.95} />
      </mesh>
      <mesh position={[-0.9, 0.63, -0.2]} rotation={[0.3, -0.2, 0.15]} castShadow>
        <boxGeometry args={[0.32, 0.12, 0.32]} />
        <meshStandardMaterial color="#7fa8a0" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** 棉麻懶骨頭 — 可愛生活系列. A slumped beanbag: wide, soft, seamed, with a carry handle. */
/** 棉麻懶骨頭 —— the one seat that should visibly deflate, and spread sideways as it does. */
function BeanbagModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Base bulge, wider than it is tall, resting ON the floor (bottom at local y = 0.003).
          `belly` widens it as the bag takes the weight — a beanbag squashed downward that did not
          also spread would be a beanbag losing volume. */}
      <group ref={anim.ref('belly')}>
        <mesh position={[0, 0.3, 0]} scale={[1, 0.45, 1]} castShadow receiveShadow>
          <sphereGeometry args={[0.66, 14, 10]} />
          <meshStandardMaterial color="#d9c9b0" roughness={1} />
        </mesh>
      </group>
      {/* Backrest lump, tipped back — the difference between a beanbag and a pouffe. */}
      <mesh position={[0, 0.62, -0.28]} rotation={[0.36, 0, 0]} scale={[1, 0.8, 0.7]} castShadow>
        <sphereGeometry args={[0.46, 12, 9]} />
        <meshStandardMaterial color="#e3d5bf" roughness={1} />
      </mesh>
      {/* The seat pad, sunk into the top of the bulge so it reads as sat-in rather than
          inflated. Its top face is local y = 0.669 -> world 0.769, which is `sit.surfaceY`;
          a beanbag has to sit HIGH because the body sinks into it, and anything under about
          0.54 world puts the character's hip through the floor (`npm run audit:ground`). */}
      <group position={[0, 0.45, 0.08]} ref={anim.ref('cushion')}>
        <mesh position={[0, 0.11, 0]} scale={[1, 0.26, 0.86]} receiveShadow>
          <sphereGeometry args={[0.42, 12, 8]} />
          <meshStandardMaterial color="#cbb99d" roughness={1} />
        </mesh>
      </group>
      {/* Seam piping around the widest part. */}
      <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.645, 0.022, 6, 20]} />
        <meshStandardMaterial color="#b8a184" roughness={1} />
      </mesh>
      {/* Fabric carry handle at the back. */}
      <mesh position={[0, 0.95, -0.46]} rotation={[Math.PI / 2 + 0.36, 0, 0]} castShadow>
        <torusGeometry args={[0.1, 0.026, 5, 12, Math.PI]} />
        <meshStandardMaterial color="#a8907a" roughness={1} />
      </mesh>
    </group>
  );
}

/** 復古扶手椅 — 鄉村系列. A wing chair: buttoned back, rolled arms, skirted base, turned feet. */
function WingArmchairModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Skirted base. */}
      <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.94, 0.3, 0.86]} />
        <meshStandardMaterial color="#8a5f52" roughness={0.9} />
      </mesh>
      {/* Seat cushion. Top face local y = 0.50 -> world 0.575. */}
      <group position={[0, 0.405, 0.03]} ref={anim.ref('cushion')}>
        <mesh position={[0, 0.0475, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.86, 0.095, 0.76]} />
          <meshStandardMaterial color="#a8756a" roughness={0.9} />
        </mesh>
      </group>
      {/* Tall back. */}
      <mesh position={[0, 0.78, -0.37]} rotation={[-0.07, 0, 0]} castShadow>
        <boxGeometry args={[0.9, 0.72, 0.15]} />
        <meshStandardMaterial color="#96685c" roughness={0.9} />
      </mesh>
      {/* Wings — the feature the chair is named for. */}
      {[-1, 1].map((s) => (
        <mesh key={`wing-${s}`} position={[s * 0.42, 0.86, -0.24]} rotation={[0, -s * 0.28, 0]} castShadow>
          <boxGeometry args={[0.1, 0.5, 0.3]} />
          <meshStandardMaterial color="#96685c" roughness={0.9} />
        </mesh>
      ))}
      {/* Buttoning — four studs in a diamond. */}
      {[[-0.17, 0.72], [0.17, 0.72], [-0.17, 0.94], [0.17, 0.94]].map(([x, y], i) => (
        <mesh key={`button-${i}`} position={[x, y, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.026, 0.026, 0.03, 8]} />
          <meshStandardMaterial color="#7a5248" roughness={0.85} />
        </mesh>
      ))}
      {/* Rolled arms. */}
      {[-1, 1].map((s) => (
        <group key={`arm-${s}`}>
          <mesh position={[s * 0.45, 0.55, 0.02]} castShadow>
            <boxGeometry args={[0.14, 0.3, 0.8]} />
            <meshStandardMaterial color="#96685c" roughness={0.9} />
          </mesh>
          <mesh position={[s * 0.45, 0.7, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.78, 10]} />
            <meshStandardMaterial color="#a8756a" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* Turned feet — two stacked discs each, the cottage signature. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <group key={`foot-${sx}-${sz}`} position={[sx * 0.4, 0, sz * 0.36]}>
          <mesh position={[0, 0.06, 0]} castShadow>
            <cylinderGeometry args={[0.045, 0.055, 0.12, 8]} />
            <meshStandardMaterial color="#8a6435" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.005, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 0.03, 8]} />
            <meshStandardMaterial color="#6b4a24" roughness={0.85} />
          </mesh>
        </group>
      )))}
    </group>
  );
}

/** 原木搖椅 — 原木系列. Slatted back, curved runners, a blanket over the back. */
/**
 * 原木搖椅 —— it actually rocks, and it does it on the SAME solver as the swing and the hammock.
 *
 * The description has always said 「坐上去會慢慢晃很久才停」 and the chair has always been
 * furniture that does not move. Making it move needed no new machinery at all: a chair on curved
 * runners turns about the runners' centre of curvature, which is a pivot above the chair, which
 * is a pendulum — so it is a row in constants/outdoorAnimation.ts's SUSPENDED_MOTIONS and a
 * `sway` on the item, and both the model (here) and the character controller
 * (Three/Avatar.tsx) read the same `suspendedAngle` with the same timeline. Not synchronised;
 * identical.
 *
 * The nested pair of groups is the pivot: the outer sits at the centre of curvature and rotates,
 * the inner puts the chair back down where it was drawn. Nothing else in the model changed, and
 * the measured collider is unaffected because at rest the two cancel exactly.
 */
const ROCKING_CHAIR_PIVOT_Y = 1.65;

function RockingChairModel({ scale, instanceId }: FurnitureModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rockRef = useRef<THREE.Group>(null);
  const timeline = useFurnitureOccupancy(instanceId);
  const wasRidden = useRef(false);

  useOutdoorAnimation(rootRef, ({ position }) => {
    const rock = rockRef.current;
    if (!rock) return;
    sampleWind(position.x, position.z, 0, FURNITURE_WIND);
    const phase = suspendedPhase(timeline.current, performance.now(), FURNITURE_WIND.sway);
    rock.rotation.x = suspendedAngle(SUSPENDED_MOTIONS.rockingChair, phase);

    // One creak as the chair takes the weight and one as it loses it. A chair that creaked on
    // every arc would be unbearable within ten seconds.
    const ridden = timeline.current.mountedAt != null;
    if (ridden !== wasRidden.current) {
      wasRidden.current = ridden;
      playFurnitureCreak(ridden ? 0.24 : 0.18);
    }
  }, { radius: 1.6, cullDistance: 34 });

  return (
    <group ref={rootRef} scale={scale}>
    <group position={[0, ROCKING_CHAIR_PIVOT_Y, 0]} ref={rockRef}>
    <group position={[0, -ROCKING_CHAIR_PIVOT_Y, 0]}>
      {/* Runners — two long shallow arcs, the piece's whole identity. Approximated by three
          short segments each rather than a torus, so the curve stays low-poly and readable. */}
      {[-0.32, 0.32].map((x) => (
        <group key={`runner-${x}`} position={[x, 0, 0]}>
          <mesh position={[0, 0.045, 0]} castShadow>
            <boxGeometry args={[0.06, 0.05, 0.62]} />
            <meshStandardMaterial color="#8a6435" roughness={0.85} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, 0.1, s * 0.42]} rotation={[s * 0.34, 0, 0]} castShadow>
              <boxGeometry args={[0.06, 0.05, 0.34]} />
              <meshStandardMaterial color="#8a6435" roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Legs. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.32, 0.28, sz * 0.26]} castShadow>
          <cylinderGeometry args={[0.032, 0.032, 0.38, 6]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      )))}
      {/* Seat. Top face local y = 0.48 -> world 0.552. */}
      <mesh position={[0, 0.45, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.06, 0.62]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
      {/* Back stiles, leaning. */}
      {[-0.32, 0.32].map((x) => (
        <mesh key={`stile-${x}`} position={[x, 0.78, -0.34]} rotation={[-0.16, 0, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.032, 0.66, 6]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      ))}
      {/* Five back slats between them. */}
      {[0.56, 0.66, 0.76, 0.86, 0.96].map((y, i) => (
        <mesh key={`slat-${i}`} position={[0, y, -0.34 + (y - 0.78) * 0.16]} rotation={[-0.16, 0, 0]} castShadow>
          <boxGeometry args={[0.6, 0.055, 0.025]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
      ))}
      {/* Crest rail with a scalloped top. */}
      <mesh position={[0, 1.06, -0.38]} rotation={[-0.16, 0, 0]} castShadow>
        <boxGeometry args={[0.72, 0.09, 0.045]} />
        <meshStandardMaterial color="#8a6435" roughness={0.8} />
      </mesh>
      {/* Arms. */}
      {[-0.34, 0.34].map((x) => (
        <mesh key={`arm-${x}`} position={[x, 0.68, 0.0]} rotation={[0.05, 0, 0]} castShadow>
          <boxGeometry args={[0.06, 0.045, 0.6]} />
          <meshStandardMaterial color="#b98a52" roughness={0.8} />
        </mesh>
      ))}
      {/* A knitted blanket thrown over the crest. */}
      <mesh position={[0.14, 0.92, -0.28]} rotation={[-0.2, 0, 0.06]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.06]} />
        <meshStandardMaterial color="#c9836f" roughness={1} />
      </mesh>
    </group>
    </group>
    </group>
  );
}

/**
 * 木製餐椅 — 原木系列. A plain ladder-back dining chair, sized to the dining tables.
 *
 * A hard chair has no cushion to give, so what it does under a sitter is CREAK and rock about a
 * degree — `frame` wraps the whole chair, which is honest: the thing that moves on a wooden chair
 * is the wooden chair.
 */
function DiningChairModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      <group ref={anim.ref('frame')}>
      {/* Four legs; the back two run up to become the stiles. */}
      {[-1, 1].map((sx) => (
        <mesh key={`fleg-${sx}`} position={[sx * 0.24, 0.24, 0.22]} castShadow>
          <boxGeometry args={[0.05, 0.48, 0.05]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={`bleg-${sx}`} position={[sx * 0.24, 0.52, -0.23]} rotation={[-0.06, 0, 0]} castShadow>
          <boxGeometry args={[0.05, 1.04, 0.05]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      ))}
      {/* Stretchers between the legs. */}
      {[0.17].map((y) => (
        <React.Fragment key={`str-${y}`}>
          <mesh position={[0, y, 0.22]} castShadow>
            <boxGeometry args={[0.44, 0.035, 0.035]} />
            <meshStandardMaterial color="#8a6435" roughness={0.85} />
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * 0.24, y, 0]} castShadow>
              <boxGeometry args={[0.035, 0.035, 0.42]} />
              <meshStandardMaterial color="#8a6435" roughness={0.85} />
            </mesh>
          ))}
        </React.Fragment>
      ))}
      {/* Seat. Top face local y = 0.50 -> world 0.575, which is its `sit.surfaceY`.
          It cannot go much lower: the character's hip sits 0.533 world below a seat surface,
          so a seat under about 0.54 puts the root through the floor — the failure
          `npm run audit:ground` catches, and the reason this chair is not simply "small". */}
      <mesh position={[0, 0.475, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.54, 0.05, 0.52]} />
        <meshStandardMaterial color="#c19a63" roughness={0.8} />
      </mesh>
      </group>
      {/* A thin tie-on cushion, so it isn't a bare board. */}
      <mesh position={[0, 0.5175, 0.01]} castShadow>
        <boxGeometry args={[0.46, 0.045, 0.44]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.95} />
      </mesh>
      {/* Two ladder rails and a crest. */}
      {[0.72, 0.84].map((y, i) => (
        <mesh key={`rail-${i}`} position={[0, y, -0.245 - (y - 0.7) * 0.06]} rotation={[-0.06, 0, 0]} castShadow>
          <boxGeometry args={[0.44, 0.07, 0.03]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, 0.97, -0.258]} rotation={[-0.06, 0, 0]} castShadow>
        <boxGeometry args={[0.53, 0.08, 0.04]} />
        <meshStandardMaterial color="#8a6435" roughness={0.8} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ 客廳 · 櫃體與燈 */

/** 原木電視櫃 — 原木系列. Long and low: two drawers, one open bay, a TV standing on top. */
function TvConsoleModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Carcass. */}
      <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.52, 0.46]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
      {/* Top slab, overhanging. */}
      <mesh position={[0, 0.64, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.06, 0.52]} />
        <meshStandardMaterial color="#8a6435" roughness={0.75} />
      </mesh>
      {/* Two drawer fronts on the left, an open bay on the right. */}
      {[-0.6, -0.6].map((x, i) => (
        <mesh key={`dr-${i}`} position={[x, 0.5 - i * 0.28, 0.238]} castShadow>
          <boxGeometry args={[0.62, 0.22, 0.025]} />
          <meshStandardMaterial color="#c9a468" roughness={0.75} />
        </mesh>
      ))}
      {[-0.6, -0.6].map((x, i) => (
        <mesh key={`pull-${i}`} position={[x, 0.5 - i * 0.28, 0.262]} castShadow>
          <boxGeometry args={[0.24, 0.025, 0.025]} />
          <meshStandardMaterial color="#3f3a2c" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0.42, 0.36, 0.19]} receiveShadow>
        <boxGeometry args={[0.9, 0.4, 0.06]} />
        <meshStandardMaterial color="#6b4a24" roughness={0.9} />
      </mesh>
      {/* A shelf splitting the bay, with two books and a basket in it. */}
      <mesh position={[0.42, 0.36, 0.0]} castShadow>
        <boxGeometry args={[0.88, 0.04, 0.42]} />
        <meshStandardMaterial color="#a3773f" roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.46, 0.02]} castShadow>
        <boxGeometry args={[0.09, 0.16, 0.24]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.85} />
      </mesh>
      <mesh position={[0.31, 0.46, 0.02]} rotation={[0, 0, 0.3]} castShadow>
        <boxGeometry args={[0.08, 0.16, 0.24]} />
        <meshStandardMaterial color="#c9836f" roughness={0.85} />
      </mesh>
      <mesh position={[0.6, 0.24, 0.0]} castShadow>
        <boxGeometry args={[0.34, 0.18, 0.3]} />
        <meshStandardMaterial color="#cfa96b" roughness={0.95} />
      </mesh>
      {/* Splayed legs. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.82, 0.05, sz * 0.16]} rotation={[sz * 0.16, 0, -sx * 0.12]} castShadow>
          <cylinderGeometry args={[0.028, 0.04, 0.2, 6]} />
          <meshStandardMaterial color="#6b4a24" roughness={0.8} />
        </mesh>
      )))}
      {/* The television. */}
      <mesh position={[0, 0.72, -0.02]} castShadow>
        <boxGeometry args={[0.28, 0.1, 0.12]} />
        <meshStandardMaterial color="#3f3a2c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.06, -0.03]} castShadow>
        <boxGeometry args={[1.16, 0.62, 0.05]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.06, 0.0]}>
        <boxGeometry args={[1.08, 0.54, 0.01]} />
        <meshStandardMaterial color="#6fa8b8" emissive="#3f7f92" emissiveIntensity={0.35} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** 玻璃展示櫃 — a tall vitrine: glazed doors, three lit shelves, treasures inside. */
function DisplayCabinetModel({ scale }: FurnitureModelProps) {
  const SHELVES = [0.62, 1.1, 1.58];
  return (
    <group scale={scale}>
      {/* Plinth. */}
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.98, 0.24, 0.46]} />
        <meshStandardMaterial color="#7c5c3a" roughness={0.85} />
      </mesh>
      {/* Side and back panels — the carcass is open at the front. */}
      {[-0.46, 0.46].map((x) => (
        <mesh key={`side-${x}`} position={[x, 1.14, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.06, 1.78, 0.44]} />
          <meshStandardMaterial color="#8a6a45" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 1.14, -0.2]} receiveShadow>
        <boxGeometry args={[0.9, 1.76, 0.035]} />
        <meshStandardMaterial color="#5f4526" roughness={0.9} />
      </mesh>
      {/* Cornice. */}
      <mesh position={[0, 2.08, 0]} castShadow>
        <boxGeometry args={[1.04, 0.1, 0.5]} />
        <meshStandardMaterial color="#7c5c3a" roughness={0.8} />
      </mesh>
      {/* Glass shelves. */}
      {SHELVES.map((y, i) => (
        <mesh key={`shelf-${i}`} position={[0, y, 0]} receiveShadow>
          <boxGeometry args={[0.88, 0.025, 0.4]} />
          <meshStandardMaterial color="#dbeefb" transparent opacity={0.5} roughness={0.1} />
        </mesh>
      ))}
      {/* Glazed front: one pane per door with a central stile. */}
      {[-0.22, 0.22].map((x) => (
        <mesh key={`pane-${x}`} position={[x, 1.14, 0.215]}>
          <boxGeometry args={[0.4, 1.72, 0.015]} />
          <meshStandardMaterial color="#dbeefb" transparent opacity={0.24} roughness={0.05} />
        </mesh>
      ))}
      <mesh position={[0, 1.14, 0.222]} castShadow>
        <boxGeometry args={[0.045, 1.76, 0.03]} />
        <meshStandardMaterial color="#8a6a45" roughness={0.8} />
      </mesh>
      {[-0.05, 0.05].map((x) => (
        <mesh key={`knob-${x}`} position={[x, 1.1, 0.245]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.03, 8]} />
          <meshStandardMaterial color="#c8a24a" metalness={0.55} roughness={0.35} />
        </mesh>
      ))}
      {/* What is being displayed — a shell, a bottle, a coral, a stack of stones. */}
      <mesh position={[-0.24, 0.72, 0.02]} rotation={[0.2, 0.4, 0]} castShadow>
        <coneGeometry args={[0.1, 0.18, 7]} />
        <meshStandardMaterial color="#f0d3a0" roughness={0.6} />
      </mesh>
      <mesh position={[0.2, 0.74, 0.0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 0.22, 10]} />
        <meshStandardMaterial color="#7fa8a0" transparent opacity={0.65} roughness={0.2} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`stone-${i}`} position={[-0.18, 1.15 + i * 0.07, 0.0]} rotation={[0, i * 0.6, 0]} castShadow>
          <dodecahedronGeometry args={[0.055 - i * 0.008, 0]} />
          <meshStandardMaterial color="#9aa09c" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0.18, 1.68, 0.0]} rotation={[0, 0.3, 0.2]} castShadow>
        <octahedronGeometry args={[0.1, 0]} />
        <meshStandardMaterial color="#a8f0e6" emissive="#4fd8c6" emissiveIntensity={0.5} transparent opacity={0.85} roughness={0.15} />
      </mesh>
    </group>
  );
}

/**
 * 弧形立燈 — a tall arc floor lamp reaching out over a seat, on a heavy stone disc.
 *
 * The arc is drawn as N short straight segments laid along a real circular arc, which is the
 * low-poly way to bend a tube without a geometry the collider measurement cannot see.
 *
 * The arithmetic is worth stating, because the first version got it wrong and shipped a row of
 * disconnected floating sticks. Take a circle of radius R centred at (0, RISE_TOP, R). A point on
 * it is
 *
 *     P(t) = (0, RISE_TOP + R·sin t, R·(1 − cos t))
 *
 * so at t=0 it sits exactly on top of the straight post with a VERTICAL tangent, and it swings
 * forward as t grows. Its tangent is (0, cos t, sin t), and a cylinder's axis is +y, so rotating
 * that cylinder by `t` about X aligns it with the tangent exactly. Each segment is then placed at
 * its own span's MIDPOINT and given the arc length of that span, so consecutive segments meet
 * end to end instead of being sampled at their starts and leaving a gap each time.
 */
function ArcFloorLampModel({ scale, item }: FurnitureModelProps) {
  const SEGMENTS = 8;
  const R = 0.8;
  /** How far round the arc goes. Just past 90 degrees, so the head tips slightly downward. */
  const SWEEP = 1.7;
  const RISE_TOP = 1.35;
  /** 8% longer than the span, so the joints overlap rather than meet exactly and gap. */
  const SEG_LEN = (R * SWEEP) / SEGMENTS * 1.08;
  const endT = SWEEP;
  const headY = RISE_TOP + R * Math.sin(endT);
  const headZ = R * (1 - Math.cos(endT));

  return (
    <group scale={scale}>
      {/* Stone base. */}
      <mesh position={[0, 0.045, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.33, 0.09, 14]} />
        <meshStandardMaterial color="#8e9aa0" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.115, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.2, 0.07, 12]} />
        <meshStandardMaterial color="#6f7a80" roughness={0.85} />
      </mesh>
      {/* Straight rise, from the collar up to where the arc begins. */}
      <mesh position={[0, (0.15 + RISE_TOP) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.026, 0.032, RISE_TOP - 0.15, 8]} />
        <meshStandardMaterial color="#c8b39a" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* The arc. */}
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const t = ((i + 0.5) / SEGMENTS) * SWEEP;
        return (
          <mesh
            key={`arc-${i}`}
            position={[0, RISE_TOP + R * Math.sin(t), R * (1 - Math.cos(t))]}
            rotation={[t, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.025, 0.025, SEG_LEN, 8]} />
            <meshStandardMaterial color="#c8b39a" metalness={0.3} roughness={0.5} />
          </mesh>
        );
      })}
      {/* Shade hanging off the far end of the arc. */}
      <mesh position={[0, headY - 0.16, headZ]} castShadow>
        <coneGeometry args={[0.24, 0.28, 14, 1, true]} />
        <meshStandardMaterial color="#f2ece0" roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <FixtureLight item={item} position={[0, headY - 0.34, headZ]}>
        <mesh position={[0, headY - 0.28, headZ]}>
          <sphereGeometry args={[0.09, 12, 10]} />
          <meshStandardMaterial color="#fff3d6" emissive="#ffe4ac" emissiveIntensity={1.4} />
        </mesh>
      </FixtureLight>
    </group>
  );
}

/* ---------------------------------------------------------------------------- 桌子 */

/** 小圓桌 — 鄉村系列. A whitewashed pedestal café table with a scalloped edge. */
function SmallRoundTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Tripod foot. */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={`foot-${i}`} position={[Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2]} rotation={[0, -a, 0.32]} castShadow>
            <boxGeometry args={[0.4, 0.06, 0.07]} />
            <meshStandardMaterial color="#d9c3a5" roughness={0.9} />
          </mesh>
        );
      })}
      {/* Turned column — three stacked profiles, which is what makes it cottage. */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.085, 0.28, 10]} />
        <meshStandardMaterial color="#efe4d2" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.38, 0]} castShadow>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color="#efe4d2" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.53, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.05, 0.24, 10]} />
        <meshStandardMaterial color="#efe4d2" roughness={0.85} />
      </mesh>
      {/* Top. */}
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.46, 0.46, 0.06, 16]} />
        <meshStandardMaterial color="#f6efe3" roughness={0.8} />
      </mesh>
      {/* Scalloped edge — eight little half-rounds around the rim. */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={`scallop-${i}`} position={[Math.cos(a) * 0.46, 0.65, Math.sin(a) * 0.46]} castShadow>
            <sphereGeometry args={[0.055, 8, 6]} />
            <meshStandardMaterial color="#e6d9c4" roughness={0.85} />
          </mesh>
        );
      })}
      {/* A mug and a jar of cuttings, because a café table with nothing on it looks unfinished. */}
      <mesh position={[0.14, 0.75, 0.1]} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.09, 10]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.5} />
      </mesh>
      <mesh position={[0.19, 0.755, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.028, 0.009, 5, 10]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.5} />
      </mesh>
      <mesh position={[-0.14, 0.77, -0.06]} castShadow>
        <cylinderGeometry args={[0.045, 0.038, 0.12, 10]} />
        <meshStandardMaterial color="#cfe3e0" transparent opacity={0.7} roughness={0.2} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`sprig-${i}`} position={[-0.14 + (i - 1) * 0.03, 0.87, -0.06]} rotation={[0, 0, (i - 1) * 0.35]} castShadow>
          <capsuleGeometry args={[0.014, 0.1, 3, 6]} />
          <meshStandardMaterial color="#5b7f4a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** 方形餐桌 — 原木系列. Four-seat square table with a chunky apron and cross stretchers. */
function SquareDiningTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Top: four planks with visible joints, not one slab. */}
      {[-0.42, -0.14, 0.14, 0.42].map((z) => (
        <mesh key={`plank-${z}`} position={[0, 0.71, z]} castShadow receiveShadow>
          <boxGeometry args={[1.16, 0.07, 0.26]} />
          <meshStandardMaterial color={z === -0.14 || z === 0.42 ? '#b98a52' : '#ad7f49'} roughness={0.8} />
        </mesh>
      ))}
      {/* Breadboard ends, running across the planks. */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={`end-${x}`} position={[x, 0.71, 0]} castShadow>
          <boxGeometry args={[0.08, 0.075, 1.16]} />
          <meshStandardMaterial color="#8a6435" roughness={0.8} />
        </mesh>
      ))}
      {/* Apron. */}
      {[-0.5, 0.5].map((z) => (
        <mesh key={`ap-z-${z}`} position={[0, 0.6, z]} castShadow>
          <boxGeometry args={[1.0, 0.13, 0.07]} />
          <meshStandardMaterial color="#8a6435" roughness={0.85} />
        </mesh>
      ))}
      {[-0.5, 0.5].map((x) => (
        <mesh key={`ap-x-${x}`} position={[x, 0.6, 0]} castShadow>
          <boxGeometry args={[0.07, 0.125, 1.0]} />
          <meshStandardMaterial color="#8a6435" roughness={0.85} />
        </mesh>
      ))}
      {/* Square posts, chamfered by a smaller box on top. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.5, 0.27, sz * 0.5]} castShadow>
          <boxGeometry args={[0.09, 0.54, 0.09]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      )))}
      {/* Cross stretchers near the floor — the structural signature vs the round table.
          They are HALF-LAPPED rather than both at one height: two identical bars at the same y
          present two coplanar up-facing tops where they cross, which is the speckle
          `npm run audit:zfighting` reports. Dropping the second one and making it shallower is
          also how the joint is actually cut, so the fix reads as joinery rather than as a nudge. */}
      <mesh position={[0, 0.12, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[1.34, 0.05, 0.05]} />
        <meshStandardMaterial color="#8a6435" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.11, 0]} rotation={[0, -Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[1.34, 0.04, 0.05]} />
        <meshStandardMaterial color="#7c5a2e" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** 長型餐桌 — 鄉村系列. A whitewashed trestle refectory table, long enough for six. */
function LongDiningTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Long plank top. */}
      {[-0.3, 0, 0.3].map((z) => (
        <mesh key={`plank-${z}`} position={[0, 0.72, z]} castShadow receiveShadow>
          <boxGeometry args={[2.3, 0.07, 0.28]} />
          <meshStandardMaterial color={z === 0 ? '#f2e8d8' : '#e9dcc7'} roughness={0.9} />
        </mesh>
      ))}
      {/* Two trestle ends: a foot, a post and a top bearer each. */}
      {[-0.86, 0.86].map((x) => (
        <group key={`trestle-${x}`} position={[x, 0, 0]}>
          <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.14, 0.1, 1.0]} />
            <meshStandardMaterial color="#d9c3a5" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.13, 0.58, 0.24]} />
            <meshStandardMaterial color="#efe4d2" roughness={0.88} />
          </mesh>
          <mesh position={[0, 0.66, 0]} castShadow>
            <boxGeometry args={[0.16, 0.08, 0.86]} />
            <meshStandardMaterial color="#d9c3a5" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* The stretcher through both trestles — the refectory signature. */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[2.0, 0.08, 0.08]} />
        <meshStandardMaterial color="#c8ad8a" roughness={0.9} />
      </mesh>
      {/* Two pegs where it passes through. */}
      {[-0.78, 0.78].map((x) => (
        <mesh key={`peg-${x}`} position={[x, 0.28, 0.06]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.06, 6]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      ))}
      {/* A runner down the middle and a bowl of fruit. */}
      <mesh position={[0, 0.757, 0]} receiveShadow>
        <boxGeometry args={[1.9, 0.012, 0.32]} />
        <meshStandardMaterial color="#9db8b0" roughness={1} />
      </mesh>
      <mesh position={[0, 0.79, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.11, 0.08, 12]} />
        <meshStandardMaterial color="#c9a468" roughness={0.9} />
      </mesh>
      {[[-0.05, 0.02], [0.05, -0.02], [0.0, 0.06]].map(([dx, dz], i) => (
        <mesh key={`fruit-${i}`} position={[dx, 0.85, dz]} castShadow>
          <sphereGeometry args={[0.055, 8, 6]} />
          <meshStandardMaterial color={['#d97706', '#65a30d', '#dc2626'][i]} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** 圓形茶几 — 原木系列. A low round coffee table on a hairpin hoop base, with a lower tier. */
function RoundCoffeeTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Steel hoop base — two rings and three uprights. */}
      {[0.03, 0.36].map((y) => (
        <mesh key={`hoop-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.34, 0.02, 6, 18]} />
          <meshStandardMaterial color="#7a6a58" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={`up-${i}`} position={[Math.cos(a) * 0.34, 0.2, Math.sin(a) * 0.34]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.36, 6]} />
            <meshStandardMaterial color="#7a6a58" metalness={0.4} roughness={0.5} />
          </mesh>
        );
      })}
      {/* Lower cane tier. */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.03, 14]} />
        <meshStandardMaterial color="#cfa96b" roughness={0.95} />
      </mesh>
      {/* Top, with a darker inlay ring. */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.58, 0.58, 0.07, 18]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.487, 0]}>
        <ringGeometry args={[0.36, 0.44, 20]} />
        <meshStandardMaterial color="#8a6435" roughness={0.85} side={THREE.DoubleSide} {...DECAL_DEPTH_BIAS} />
      </mesh>
      {/* Two magazines and a candle on top. */}
      <mesh position={[-0.2, 0.5, 0.1]} rotation={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.28, 0.02, 0.2]} />
        <meshStandardMaterial color="#c9836f" roughness={0.9} />
      </mesh>
      <mesh position={[-0.19, 0.52, 0.09]} rotation={[0, -0.15, 0]} castShadow>
        <boxGeometry args={[0.26, 0.02, 0.19]} />
        <meshStandardMaterial color="#7fa8a0" roughness={0.9} />
      </mesh>
      <mesh position={[0.2, 0.53, -0.06]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.1, 10]} />
        <meshStandardMaterial color="#f2ece0" roughness={0.85} />
      </mesh>
      <mesh position={[0.2, 0.6, -0.06]}>
        <coneGeometry args={[0.022, 0.05, 6]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

/** 藤編邊桌 — 海島系列. A woven cone drum: no legs at all, which is its whole silhouette. */
function RattanSideTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* The woven body: a ring of slightly leaning staves making a truncated cone. */}
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return (
          <mesh
            key={`stave-${i}`}
            position={[Math.cos(a) * 0.27, 0.26, Math.sin(a) * 0.27]}
            rotation={[Math.sin(a) * 0.13, -a, -Math.cos(a) * 0.13]}
            castShadow
          >
            <boxGeometry args={[0.05, 0.52, 0.1]} />
            <meshStandardMaterial color={i % 2 ? '#cfa96b' : '#bd9557'} roughness={0.95} />
          </mesh>
        );
      })}
      {/* Three binding hoops. */}
      {[0.06, 0.26, 0.46].map((y, i) => (
        <mesh key={`hoop-${i}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.28 + (i === 1 ? 0.005 : 0), 0.022, 6, 18]} />
          <meshStandardMaterial color="#a8834b" roughness={0.95} />
        </mesh>
      ))}
      {/* Glass top with a cane rim. */}
      <mesh position={[0, 0.545, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.33, 0.33, 0.03, 16]} />
        <meshStandardMaterial color="#dbeefb" transparent opacity={0.42} roughness={0.08} />
      </mesh>
      <mesh position={[0, 0.545, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.33, 0.026, 6, 20]} />
        <meshStandardMaterial color="#c9a468" roughness={0.9} />
      </mesh>
      {/* A shell resting on it. */}
      <mesh position={[0.09, 0.6, 0.04]} rotation={[0.4, 0.6, 0]} castShadow>
        <coneGeometry args={[0.08, 0.14, 7]} />
        <meshStandardMaterial color="#f0d3a0" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** 折疊露營桌 — 海島系列. Slatted top on a scissor X-frame, with the hinge showing. */
function FoldingTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* X-frame legs, both directions, at each end. */}
      {[-0.42, 0.42].map((z) => (
        <group key={`x-${z}`} position={[0, 0, z]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, 0.28, 0]} rotation={[0, 0, s * 0.55]} castShadow>
              <boxGeometry args={[0.045, 0.68, 0.045]} />
              <meshStandardMaterial color="#c8b39a" metalness={0.25} roughness={0.6} />
            </mesh>
          ))}
          {/* The hinge bolt where they cross. */}
          <mesh position={[0, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 0.06, 8]} />
            <meshStandardMaterial color="#6b6257" metalness={0.5} roughness={0.45} />
          </mesh>
          {/* Foot bars. */}
          {[-1, 1].map((s) => (
            <mesh key={`foot-${s}`} position={[s * 0.32, 0.015, 0]} castShadow>
              <boxGeometry args={[0.1, 0.03, 0.1]} />
              <meshStandardMaterial color="#3f3a2c" roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Rails the slats sit on. */}
      {[-0.32, 0.32].map((x) => (
        <mesh key={`rail-${x}`} position={[x, 0.55, 0]} castShadow>
          <boxGeometry args={[0.05, 0.045, 0.94]} />
          <meshStandardMaterial color="#c8b39a" metalness={0.25} roughness={0.6} />
        </mesh>
      ))}
      {/* Slatted top — seven boards with gaps, so the table reads as packable. */}
      {[-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42].map((z) => (
        <mesh key={`slat-${z}`} position={[0, 0.59, z]} castShadow receiveShadow>
          <boxGeometry args={[0.86, 0.035, 0.11]} />
          <meshStandardMaterial color="#d8b98a" roughness={0.9} />
        </mesh>
      ))}
      {/* An enamel mug left on it. */}
      <mesh position={[0.22, 0.65, 0.14]} castShadow>
        <cylinderGeometry args={[0.055, 0.05, 0.1, 10]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.45} />
      </mesh>
    </group>
  );
}

/** 柚木戶外桌 — 海島系列. Weathered teak, slatted top with a parasol hole, cross-brace legs. */
function TeakOutdoorTableModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* A-frame ends. */}
      {[-0.62, 0.62].map((x) => (
        <group key={`end-${x}`} position={[x, 0, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, 0.32, s * 0.28] } rotation={[-s * 0.2, 0, 0]} castShadow>
              <boxGeometry args={[0.08, 0.66, 0.08]} />
              <meshStandardMaterial color="#9c8058" roughness={0.95} />
            </mesh>
          ))}
          <mesh position={[0, 0.34, 0]} castShadow>
            <boxGeometry args={[0.06, 0.06, 0.6]} />
            <meshStandardMaterial color="#8a7048" roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* Long brace between the ends. */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[1.1, 0.06, 0.06]} />
        <meshStandardMaterial color="#8a7048" roughness={0.95} />
      </mesh>
      {/* Slatted top with a gap in the middle — the parasol hole. */}
      {[-0.46, -0.31, -0.16, 0.16, 0.31, 0.46].map((z) => (
        <mesh key={`slat-${z}`} position={[0, 0.7, z]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.055, 0.12]} />
          <meshStandardMaterial color={Math.abs(z) > 0.4 ? '#a88a5e' : '#b39468'} roughness={0.95} />
        </mesh>
      ))}
      {/* Two short slats flanking the hole, keeping the top rectangular. */}
      {[-1, 1].map((s) => (
        <mesh key={`short-${s}`} position={[s * 0.56, 0.7, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.38, 0.055, 0.2]} />
          <meshStandardMaterial color="#b39468" roughness={0.95} />
        </mesh>
      ))}
      {/* Rim boards across the ends. */}
      {[-0.72, 0.72].map((x) => (
        <mesh key={`rim-${x}`} position={[x, 0.7, 0]} castShadow>
          <boxGeometry args={[0.07, 0.06, 1.1]} />
          <meshStandardMaterial color="#8a7048" roughness={0.95} />
        </mesh>
      ))}
      {/* The parasol socket, empty and visible. */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.08, 10, 1, true]} />
        <meshStandardMaterial color="#5f5240" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** 松木工作桌 — 原木系列. A workbench: thick top, pegboard back, a vice and a tool tray. */
/** 松木工作桌 —— 閱讀: the sketchbook on the top opens and the vise's screw eases out. */
function PineWorkbenchModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* A sketchbook lying on the bench, hinged along its own -X edge. */}
      <group position={[0.02, 0.868, 0.14]} rotation={[0, -0.14, 0]}>
        <mesh position={[0.15, -0.014, 0]} castShadow>
          <boxGeometry args={[0.3, 0.026, 0.38]} />
          <meshStandardMaterial color="#f4ecd8" roughness={0.95} />
        </mesh>
        <group ref={anim.ref('bookCover')}>
          <mesh position={[0.15, 0.005, 0]} castShadow>
            <boxGeometry args={[0.3, 0.014, 0.38]} />
            <meshStandardMaterial color="#8a6435" roughness={0.8} />
          </mesh>
        </group>
      </group>
      {/* Legs — square posts, splayed slightly outward at the foot. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.72, 0.36, sz * 0.34]} castShadow>
          <boxGeometry args={[0.1, 0.72, 0.1]} />
          <meshStandardMaterial color="#c19a63" roughness={0.9} />
        </mesh>
      )))}
      {/* Lower shelf between the legs, with two crates on it. */}
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.44, 0.05, 0.66]} />
        <meshStandardMaterial color="#a3773f" roughness={0.9} />
      </mesh>
      {[-0.4, 0.42].map((x, i) => (
        <mesh key={`crate-${i}`} position={[x, 0.36, 0]} castShadow>
          <boxGeometry args={[0.38, 0.24, 0.44]} />
          <meshStandardMaterial color={i ? '#8fa9a2' : '#c9836f'} roughness={0.9} />
        </mesh>
      ))}
      {/* Thick laminated top — three boards edge on. */}
      {[-0.26, 0, 0.26].map((z) => (
        <mesh key={`board-${z}`} position={[0, 0.79, z]} castShadow receiveShadow>
          <boxGeometry args={[1.66, 0.1, 0.25]} />
          <meshStandardMaterial color={z === 0 ? '#d8b98a' : '#cdad7c'} roughness={0.85} />
        </mesh>
      ))}
      {/* Pegboard back with three hanging tools. */}
      <mesh position={[0, 1.16, -0.42]} castShadow>
        <boxGeometry args={[1.6, 0.64, 0.04]} />
        <meshStandardMaterial color="#b9a184" roughness={0.95} />
      </mesh>
      {[-0.4, 0.0, 0.4].map((x, i) => (
        <mesh key={`tool-${i}`} position={[x, 1.2 - i * 0.04, -0.38]} rotation={[0, 0, i === 1 ? 0.2 : -0.15]} castShadow>
          <boxGeometry args={[0.06, 0.3 - i * 0.05, 0.03]} />
          <meshStandardMaterial color={['#6b7280', '#8a6435', '#3f6f6a'][i]} roughness={0.7} />
        </mesh>
      ))}
      {/* Vice on the near left corner. */}
      <mesh position={[-0.66, 0.9, 0.2]} castShadow>
        <boxGeometry args={[0.2, 0.14, 0.16]} />
        <meshStandardMaterial color="#6b7280" metalness={0.5} roughness={0.5} />
      </mesh>
      <group position={[-0.66, 0.9, 0.32]} ref={anim.ref('viseJaw')}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.16, 8]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
      {/* Tool tray along the back edge, with a jar of pencils. */}
      <mesh position={[0.4, 0.87, -0.3]} castShadow>
        <boxGeometry args={[0.5, 0.06, 0.14]} />
        <meshStandardMaterial color="#a3773f" roughness={0.9} />
      </mesh>
      <mesh position={[0.62, 0.92, -0.16]} castShadow>
        <cylinderGeometry args={[0.055, 0.05, 0.14, 10]} />
        <meshStandardMaterial color="#cfe3e0" transparent opacity={0.7} roughness={0.2} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`pencil-${i}`} position={[0.62 + (i - 1) * 0.02, 1.02, -0.16]} rotation={[0, 0, (i - 1) * 0.24]} castShadow>
          <cylinderGeometry args={[0.008, 0.008, 0.16, 6]} />
          <meshStandardMaterial color={['#d97706', '#dc2626', '#16a34a'][i]} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------------------------------------------------------- 臥室 */

/**
 * 原木單人床. Half the width of the double, with a slatted head and foot board.
 * Mattress top local y = 0.625, matching the double bed's, so both use the same `lie` height.
 */
function SingleWoodBedModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Rails and legs, so the frame is a frame rather than a solid block. */}
      {[-0.55, 0.55].map((x) => (
        <mesh key={`rail-${x}`} position={[x, 0.265, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.18, 2.16]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.53, 0.09, sz * 1.02]} castShadow>
          <boxGeometry args={[0.1, 0.18, 0.1]} />
          <meshStandardMaterial color="#8a6435" roughness={0.85} />
        </mesh>
      )))}
      {/* Slat deck. */}
      <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.04, 0.05, 2.1]} />
        <meshStandardMaterial color="#c19a63" roughness={0.9} />
      </mesh>
      {/* Mattress. Top face local y = 0.625. */}
      <group position={[0, 0.375, 0.03]} ref={anim.ref('mattress')}>
        <mesh position={[0, 0.125, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.0, 0.25, 2.0]} />
          <meshStandardMaterial color="#f7f3ea" roughness={0.75} />
        </mesh>
      </group>
      {/* Folded quilt over the lower half, with a stripe. */}
      <mesh position={[0, 0.65, 0.52]} castShadow>
        <boxGeometry args={[1.02, 0.07, 0.96]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.69, 0.16]} castShadow>
        <boxGeometry args={[1.03, 0.05, 0.2]} />
        <meshStandardMaterial color="#c9836f" roughness={0.95} />
      </mesh>
      {/* One pillow. */}
      <mesh position={[0, 0.7, -0.72]} rotation={[-0.12, 0, 0]} castShadow>
        <boxGeometry args={[0.76, 0.14, 0.42]} />
        <meshStandardMaterial color="#efe4d2" roughness={0.9} />
      </mesh>
      {/* Slatted headboard: two posts and four rails. */}
      {[-0.53, 0.53].map((x) => (
        <mesh key={`hpost-${x}`} position={[x, 0.72, -1.08]} castShadow>
          <boxGeometry args={[0.09, 1.1, 0.09]} />
          <meshStandardMaterial color="#8a6435" roughness={0.85} />
        </mesh>
      ))}
      {[0.6, 0.79, 0.98, 1.17].map((y, i) => (
        <mesh key={`hrail-${i}`} position={[0, y, -1.08]} castShadow>
          <boxGeometry args={[1.0, 0.11, 0.05]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
      ))}
      {/* Lower footboard, same language. */}
      {[-0.53, 0.53].map((x) => (
        <mesh key={`fpost-${x}`} position={[x, 0.5, 1.08]} castShadow>
          <boxGeometry args={[0.09, 0.66, 0.09]} />
          <meshStandardMaterial color="#8a6435" roughness={0.85} />
        </mesh>
      ))}
      {[0.63, 0.78].map((y, i) => (
        <mesh key={`frail-${i}`} position={[0, y, 1.08]} castShadow>
          <boxGeometry args={[1.0, 0.095, 0.05]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 帳篷風格床 — 可愛生活系列. A low platform mattress under a canvas A-frame canopy with
 * bunting and a string of lights. The mattress sits LOW (top local 0.42) because you crawl in.
 */
function CanopyTentBedModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Low platform. */}
      <mesh position={[0, 0.11, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.22, 2.16]} />
        <meshStandardMaterial color="#c19a63" roughness={0.9} />
      </mesh>
      {/* Mattress. Top face local y = 0.42. */}
      <group position={[0, 0.20, 0.02]} ref={anim.ref('mattress')}>
        <mesh position={[0, 0.11, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.18, 0.22, 2.04]} />
          <meshStandardMaterial color="#f7f3ea" roughness={0.8} />
        </mesh>
      </group>
      {/* Duvet and two small pillows. */}
      <mesh position={[0, 0.45, 0.5]} castShadow>
        <boxGeometry args={[1.2, 0.08, 1.0]} />
        <meshStandardMaterial color="#e8a09a" roughness={0.95} />
      </mesh>
      {[-0.28, 0.28].map((x) => (
        <mesh key={`pil-${x}`} position={[x, 0.48, -0.74]} rotation={[-0.1, 0, 0]} castShadow>
          <boxGeometry args={[0.5, 0.13, 0.36]} />
          <meshStandardMaterial color="#f2ece0" roughness={0.9} />
        </mesh>
      ))}
      {/* The A-frame canopy.
       *
       * The ridge sits at RIDGE_Y over x=0; each canvas panel runs from there down to the edge of
       * the platform at (±HALF_W, EAVE_Y). So the panel's own length is the SLANT — the hypotenuse
       * — and its tilt is the angle of that hypotenuse, not a guessed constant. Rotating a box by
       * `TILT` about Z carries its local +y to (−sin TILT, cos TILT, 0), which is the slant line,
       * and placing it at the slant's MIDPOINT is what makes the two panels actually meet at the
       * ridge and actually land on the platform. Guessing those numbers instead is how the first
       * version ended up as two giant boards leaning through each other. */}
      {(() => {
        const RIDGE_Y = 1.5;
        const EAVE_Y = 0.42;
        const HALF_W = 0.65;
        const SLANT = Math.hypot(HALF_W, RIDGE_Y - EAVE_Y);
        const TILT = Math.atan2(HALF_W, RIDGE_Y - EAVE_Y);
        const MID_X = HALF_W / 2;
        const MID_Y = (RIDGE_Y + EAVE_Y) / 2;
        return (
          // The whole canopy breathes once somebody is in the bed — a `wobble` of about a degree,
          // pivoted at the platform so the eaves move and the ridge barely does.
          <group ref={anim.ref('canopy')}>
            {/* Two canvas panels. */}
            {[-1, 1].map((s) => (
              <mesh key={`canvas-${s}`} position={[s * MID_X, MID_Y, 0]} rotation={[0, 0, s * TILT]} castShadow>
                <boxGeometry args={[0.04, SLANT, 1.94]} />
                <meshStandardMaterial color="#f0e8d8" roughness={1} />
              </mesh>
            ))}
            {/* Four poles framing the canvas edges, on the same slant. */}
            {[-1, 1].map((sz) =>
              [-1, 1].map((sx) => (
                <mesh
                  key={`pole-${sx}-${sz}`}
                  position={[sx * MID_X, MID_Y, sz * 0.98]}
                  rotation={[0, 0, sx * TILT]}
                  castShadow
                >
                  <cylinderGeometry args={[0.032, 0.032, SLANT, 6]} />
                  <meshStandardMaterial color="#a3773f" roughness={0.9} />
                </mesh>
              ))
            )}
            {/* Ridge pole, running the length of the bed. */}
            <mesh position={[0, RIDGE_Y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.03, 0.03, 2.04, 6]} />
              <meshStandardMaterial color="#8a6435" roughness={0.9} />
            </mesh>
            {/* Bunting hanging just under the ridge — five little flags. */}
            {[-0.72, -0.36, 0, 0.36, 0.72].map((z, i) => (
              <mesh key={`flag-${i}`} position={[0, RIDGE_Y - 0.11, z]} rotation={[0, 0, Math.PI]} castShadow>
                <coneGeometry args={[0.06, 0.15, 3]} />
                <meshStandardMaterial color={['#e8a09a', '#8fa9a2', '#e8c37a', '#c9836f', '#9db8b0'][i]} roughness={0.95} />
              </mesh>
            ))}
            {/* Three fairy lights strung along it. On the house circuit, so they go out with
                the room — a bed is not a 燈具, but a light is a light. */}
            <FixtureLight item={item} position={[0, RIDGE_Y - 0.3, 0]}>
              {[-0.55, 0.05, 0.6].map((z, i) => (
                <mesh key={`bulb-${i}`} position={[0.05, RIDGE_Y - 0.2, z]}>
                  <sphereGeometry args={[0.038, 8, 6]} />
                  <meshStandardMaterial color="#fff2cc" emissive="#ffdf9e" emissiveIntensity={1.3} />
                </mesh>
              ))}
            </FixtureLight>
          </group>
        );
      })()}
    </group>
  );
}

/** 抽屜櫃 — 簡約系列. Six drawers in two columns, tapered legs, a tray on top. */
function DresserModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Carcass. */}
      <mesh position={[0, 0.66, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.24, 0.92, 0.5]} />
        <meshStandardMaterial color="#e6e1d7" roughness={0.85} />
      </mesh>
      {/* Top slab in a contrasting wood. */}
      <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.32, 0.06, 0.56]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
      {/* Six drawer fronts. */}
      {[-0.31, 0.31].map((x) =>
        [0.35, 0.66, 0.97].map((y) => (
          <React.Fragment key={`d-${x}-${y}`}>
            <mesh position={[x, y, 0.258]} castShadow>
              <boxGeometry args={[0.56, 0.27, 0.025]} />
              <meshStandardMaterial color="#f3efe8" roughness={0.8} />
            </mesh>
            {/* Cut-out finger pull along the top edge of each drawer. */}
            <mesh position={[x, y + 0.1, 0.276]}>
              <boxGeometry args={[0.24, 0.03, 0.02]} />
              <meshStandardMaterial color="#9aa4a8" roughness={0.6} />
            </mesh>
          </React.Fragment>
        ))
      )}
      {/* Tapered legs. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`leg-${sx}-${sz}`} position={[sx * 0.53, 0.1, sz * 0.19]} rotation={[sz * 0.1, 0, -sx * 0.08]} castShadow>
          <cylinderGeometry args={[0.028, 0.042, 0.2, 6]} />
          <meshStandardMaterial color="#b98a52" roughness={0.8} />
        </mesh>
      )))}
      {/* A tray with two folded things on top. */}
      <mesh position={[-0.3, 1.2, 0.02]} castShadow>
        <boxGeometry args={[0.4, 0.03, 0.28]} />
        <meshStandardMaterial color="#c9a468" roughness={0.9} />
      </mesh>
      <mesh position={[-0.3, 1.24, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.06, 0.2]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.95} />
      </mesh>
      <mesh position={[0.34, 1.24, 0.0]} castShadow>
        <cylinderGeometry args={[0.09, 0.11, 0.12, 12]} />
        <meshStandardMaterial color="#cfe3e0" roughness={0.4} />
      </mesh>
    </group>
  );
}

/** 梳妝台 — 鄉村系列. Whitewashed table with a round mirror, a stool and small jars. */
/**
 * 梳妝台 —— 整理儀容, and the brief's 「抽屜拉出／推回」 case.
 *
 * Each drawer front was a flat panel glued to the apron. It is now a `<group>` at the front's own
 * position holding the front, its knob and a shallow box BEHIND it — which is invisible while the
 * drawer is shut (it lives inside the apron) and is the whole reason a pulled-out drawer reads as
 * a drawer rather than as a panel floating in mid-air. The box is inside the apron's existing
 * extent, so the measured collider does not change.
 */
/** One vanity drawer: its front, its knob, and the box behind — which is what sells the pull. */
function VanityDrawer({ contents }: { contents: string }) {
  return (
    <>
      <mesh castShadow>
        <boxGeometry args={[0.4, 0.1, 0.025]} />
        <meshStandardMaterial color="#f7f1e6" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0, 0.022]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* The box behind the front. Sits inside the apron while shut, so it costs the closed piece
          nothing at all — including in the measured collider. */}
      <mesh position={[0, -0.012, -0.1]}>
        <boxGeometry args={[0.36, 0.075, 0.18]} />
        <meshStandardMaterial color="#d9c3a5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.014, -0.1]}>
        <boxGeometry args={[0.28, 0.02, 0.12]} />
        <meshStandardMaterial color={contents} roughness={0.85} />
      </mesh>
    </>
  );
}

function VanityTableModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Table top and apron. */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.14, 0.06, 0.46]} />
        <meshStandardMaterial color="#f2e8d8" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.65, -0.02]} castShadow>
        <boxGeometry args={[1.0, 0.13, 0.36]} />
        <meshStandardMaterial color="#e6d9c4" roughness={0.88} />
      </mesh>
      {/* Two shallow drawers, each hung off its own front so it can be pulled. Spelt out for the
          same reason the hob's knobs are — see StoveKnob. */}
      <group position={[-0.28, 0.65, 0.17]} ref={anim.ref('drawerLeft')}>
        <VanityDrawer contents="#e8a09a" />
      </group>
      <group position={[0.28, 0.65, 0.17]} ref={anim.ref('drawerRight')}>
        <VanityDrawer contents="#8fa9a2" />
      </group>
      {/* Turned legs. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <group key={`leg-${sx}-${sz}`} position={[sx * 0.5, 0, sz * 0.17]}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.032, 0.04, 0.6, 8]} />
            <meshStandardMaterial color="#e6d9c4" roughness={0.88} />
          </mesh>
          <mesh position={[0, 0.42, 0]} castShadow>
            <sphereGeometry args={[0.055, 8, 6]} />
            <meshStandardMaterial color="#efe4d2" roughness={0.88} />
          </mesh>
        </group>
      )))}
      {/* Round mirror on two uprights. */}
      {[-0.3, 0.3].map((x) => (
        <mesh key={`up-${x}`} position={[x, 0.94, -0.14]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.36, 6]} />
          <meshStandardMaterial color="#d9c3a5" roughness={0.88} />
        </mesh>
      ))}
      <mesh position={[0, 1.28, -0.14]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.34, 0.035, 6, 20]} />
        <meshStandardMaterial color="#e6d9c4" roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.28, -0.14]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.02, 20]} />
        <meshStandardMaterial color="#cfe3e0" metalness={0.5} roughness={0.15} />
      </mesh>
      {/* Jars and a hairbrush on the top. */}
      <mesh position={[-0.36, 0.81, 0.06]} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.09, 10]} />
        <meshStandardMaterial color="#cfe3e0" transparent opacity={0.75} roughness={0.2} />
      </mesh>
      <mesh position={[-0.24, 0.79, 0.1]} castShadow>
        <cylinderGeometry args={[0.035, 0.032, 0.06, 10]} />
        <meshStandardMaterial color="#e8a09a" roughness={0.6} />
      </mesh>
      <mesh position={[0.34, 0.785, 0.08]} rotation={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.16, 0.03, 0.07]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 全身鏡 — 簡約系列. A leaning full-length mirror on a slim frame with a felt foot. */
function StandingMirrorModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* The whole thing leans back 8 degrees — that lean is the piece. */}
      <group rotation={[0.14, 0, 0]}>
        {/* Frame: four thin members rather than one slab, so the glass is genuinely inset. */}
        {[-0.34, 0.34].map((x) => (
          <mesh key={`side-${x}`} position={[x, 0.9, 0]} castShadow>
            <boxGeometry args={[0.06, 1.8, 0.06]} />
            <meshStandardMaterial color="#b98a52" roughness={0.8} />
          </mesh>
        ))}
        {[0.03, 1.77].map((y) => (
          <mesh key={`rail-${y}`} position={[0, y, 0]} castShadow>
            <boxGeometry args={[0.7, 0.06, 0.055]} />
            <meshStandardMaterial color="#b98a52" roughness={0.8} />
          </mesh>
        ))}
        {/* Glass, recessed 1cm behind the frame face. */}
        <mesh position={[0, 0.9, -0.01]}>
          <boxGeometry args={[0.64, 1.7, 0.02]} />
          <meshStandardMaterial color="#dfeaee" metalness={0.6} roughness={0.08} />
        </mesh>
        {/* A soft highlight band, so the glass reads as reflective at a glance. */}
        <mesh position={[-0.12, 1.1, 0.002]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.14, 0.9, 0.006]} />
          <meshStandardMaterial color="#f4fbfd" transparent opacity={0.5} roughness={0.05} />
        </mesh>
      </group>
      {/* Felt foot bar that keeps it off the wall. */}
      <mesh position={[0, 0.02, 0.16]} castShadow>
        <boxGeometry args={[0.76, 0.04, 0.14]} />
        <meshStandardMaterial color="#8a9aa2" roughness={0.95} />
      </mesh>
      {/* A scarf hung over one corner — the touch of life. */}
      <mesh position={[0.3, 1.6, 0.05]} rotation={[0.1, 0, 0.08]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.04]} />
        <meshStandardMaterial color="#c9836f" roughness={1} />
      </mesh>
    </group>
  );
}

/** 衣帽架 — a tree-shaped coat stand: three-foot base, tapered post, six pegs, things hung on it. */
function CoatRackModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Three splayed feet. */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        return (
          <mesh key={`foot-${i}`} position={[Math.cos(a) * 0.22, 0.05, Math.sin(a) * 0.22]} rotation={[0, -a, 0.3]} castShadow>
            <boxGeometry args={[0.44, 0.055, 0.07]} />
            <meshStandardMaterial color="#8a6435" roughness={0.85} />
          </mesh>
        );
      })}
      {/* Post. */}
      <mesh position={[0, 0.92, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.055, 1.76, 8]} />
        <meshStandardMaterial color="#b98a52" roughness={0.85} />
      </mesh>
      {/* Two rings of pegs, offset from each other. */}
      {[
        { y: 1.5, tilt: 0.4, offset: 0 },
        { y: 1.74, tilt: 0.3, offset: Math.PI / 3 },
      ].map((ring, r) =>
        [0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + ring.offset;
          return (
            <mesh
              key={`peg-${r}-${i}`}
              position={[Math.cos(a) * 0.11, ring.y, Math.sin(a) * 0.11]}
              rotation={[Math.sin(a) * (Math.PI / 2 - ring.tilt), 0, -Math.cos(a) * (Math.PI / 2 - ring.tilt)]}
              castShadow
            >
              <cylinderGeometry args={[0.022, 0.028, 0.22, 6]} />
              <meshStandardMaterial color="#a3773f" roughness={0.85} />
            </mesh>
          );
        })
      )}
      {/* Finial. */}
      <mesh position={[0, 1.84, 0]} castShadow>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color="#8a6435" roughness={0.8} />
      </mesh>
      {/* A straw hat on one peg, and a tote bag on another. */}
      <group position={[0.2, 1.72, 0.06]} rotation={[0.2, 0, -0.4]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.26, 0.28, 0.02, 14]} />
          <meshStandardMaterial color="#e8d5a8" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.15, 0.12, 12]} />
          <meshStandardMaterial color="#dcc78e" roughness={0.95} />
        </mesh>
      </group>
      <mesh position={[-0.18, 1.28, -0.1]} rotation={[0, 0.4, 0.06]} castShadow>
        <boxGeometry args={[0.26, 0.34, 0.1]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.95} />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------- 收納・書房 */

/** 梯形書架 — 簡約系列. A leaning ladder shelf: five shelves that get shallower going up. */
function LadderBookcaseModel({ scale }: FurnitureModelProps) {
  const SHELVES = [
    { y: 0.24, depth: 0.42 },
    { y: 0.66, depth: 0.37 },
    { y: 1.08, depth: 0.32 },
    { y: 1.5, depth: 0.27 },
    { y: 1.92, depth: 0.22 },
  ];
  return (
    <group scale={scale}>
      {/* Two leaning stiles. The lean is why the shelves taper. */}
      {[-0.44, 0.44].map((x) => (
        <mesh key={`stile-${x}`} position={[x, 1.05, -0.16]} rotation={[0.14, 0, 0]} castShadow>
          <boxGeometry args={[0.06, 2.14, 0.06]} />
          <meshStandardMaterial color="#98a8ad" roughness={0.7} />
        </mesh>
      ))}
      {SHELVES.map((s, i) => (
        <mesh key={`shelf-${i}`} position={[0, s.y, -0.16 + (1.05 - s.y) * 0.141]} castShadow receiveShadow>
          <boxGeometry args={[0.86, 0.04, s.depth]} />
          <meshStandardMaterial color="#e6e1d7" roughness={0.8} />
        </mesh>
      ))}
      {/* What is on them: books low down, a plant and a frame higher up. */}
      {[-0.28, -0.16, -0.05].map((x, i) => (
        <mesh key={`bk-${i}`} position={[x, 0.38, -0.04]} castShadow>
          <boxGeometry args={[0.09, 0.24, 0.2]} />
          <meshStandardMaterial color={['#3f6f6a', '#c9836f', '#e8c37a'][i]} roughness={0.85} />
        </mesh>
      ))}
      {[0.14, 0.26].map((x, i) => (
        <mesh key={`bk2-${i}`} position={[x, 0.78, 0.02]} rotation={[0, 0, i ? 0.3 : 0]} castShadow>
          <boxGeometry args={[0.08, 0.22, 0.18]} />
          <meshStandardMaterial color={i ? '#9db8b0' : '#7c3aed'} roughness={0.85} />
        </mesh>
      ))}
      {/* Trailing plant on the third shelf. */}
      <mesh position={[-0.24, 1.16, 0.02]} castShadow>
        <cylinderGeometry args={[0.08, 0.06, 0.13, 10]} />
        <meshStandardMaterial color="#c9a48a" roughness={0.9} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={`vine-${i}`} position={[-0.24, 1.12 - i * 0.09, 0.06 + i * 0.01]} rotation={[0, 0, 0.4 + i * 0.2]} castShadow>
          <capsuleGeometry args={[0.022, 0.08, 3, 6]} />
          <meshStandardMaterial color="#5b7f4a" roughness={0.9} />
        </mesh>
      ))}
      {/* Leaning picture on the top shelf. */}
      <mesh position={[0.16, 2.02, -0.02]} rotation={[0.14, 0, 0]} castShadow>
        <boxGeometry args={[0.24, 0.18, 0.02]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 文件櫃 — a four-drawer steel filing cabinet with label holders and a plant on top. */
function FilingCabinetModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Body. */}
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.56, 1.32, 0.62]} />
        <meshStandardMaterial color="#8e9aa0" metalness={0.35} roughness={0.6} />
      </mesh>
      {/* Plinth. */}
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[0.52, 0.06, 0.58]} />
        <meshStandardMaterial color="#5b6469" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Four drawer fronts with a recessed gap between each. */}
      {[0.24, 0.56, 0.88, 1.2].map((y, i) => (
        <React.Fragment key={`d-${i}`}>
          <mesh position={[0, y, 0.318]} castShadow>
            <boxGeometry args={[0.52, 0.28, 0.025]} />
            <meshStandardMaterial color="#a3aeb3" metalness={0.3} roughness={0.55} />
          </mesh>
          {/* Recessed pull. */}
          <mesh position={[0, y + 0.09, 0.338]}>
            <boxGeometry args={[0.2, 0.035, 0.02]} />
            <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
          </mesh>
          {/* Card label holder. */}
          <mesh position={[0, y - 0.05, 0.336]}>
            <boxGeometry args={[0.16, 0.05, 0.015]} />
            <meshStandardMaterial color="#f2ece0" roughness={0.85} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Top with a small plant and a stack of folders. */}
      <mesh position={[0, 1.36, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.04, 0.66]} />
        <meshStandardMaterial color="#6f7a80" metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[-0.13, 1.44, 0.06]} castShadow>
        <cylinderGeometry args={[0.08, 0.06, 0.12, 10]} />
        <meshStandardMaterial color="#c2703d" roughness={0.85} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`leaf-${i}`} position={[-0.13, 1.56, 0.06]} rotation={[0.5, (i * Math.PI * 2) / 3, 0]} castShadow>
          <capsuleGeometry args={[0.035, 0.14, 3, 6]} />
          <meshStandardMaterial color="#5b7f4a" roughness={0.9} />
        </mesh>
      ))}
      {[0, 1].map((i) => (
        <mesh key={`folder-${i}`} position={[0.14, 1.4 + i * 0.03, -0.06]} rotation={[0, i * 0.2, 0]} castShadow>
          <boxGeometry args={[0.26, 0.025, 0.34]} />
          <meshStandardMaterial color={i ? '#e8c37a' : '#c9836f'} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** 藤編收納籃 — 海島系列. A tall lidded basket with rope handles, lid slightly ajar. */
function StorageBasketModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Body: alternating weave courses, five of them. */}
      {[0.07, 0.19, 0.31, 0.43, 0.55].map((y, i) => (
        <mesh key={`course-${i}`} position={[0, y, 0]} rotation={[0, i * 0.22, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.32 + i * 0.006, 0.31 + i * 0.006, 0.12, 14]} />
          <meshStandardMaterial color={i % 2 ? '#cfa96b' : '#bd9557'} roughness={0.95} />
        </mesh>
      ))}
      {/* Rim. */}
      <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.35, 0.03, 6, 20]} />
        <meshStandardMaterial color="#a8834b" roughness={0.95} />
      </mesh>
      {/* Lid, sitting slightly askew — the detail that makes it look used. */}
      <mesh position={[0.03, 0.68, 0.02]} rotation={[0.06, 0.3, 0.04]} castShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.05, 14]} />
        <meshStandardMaterial color="#d9b57f" roughness={0.95} />
      </mesh>
      <mesh position={[0.03, 0.73, 0.02]} rotation={[0.06, 0.3, 0.04]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.05, 10]} />
        <meshStandardMaterial color="#a8834b" roughness={0.9} />
      </mesh>
      {/* Two rope handles. */}
      {[-1, 1].map((s) => (
        <mesh key={`handle-${s}`} position={[s * 0.34, 0.44, 0]} rotation={[Math.PI / 2, 0, s * Math.PI / 2]} castShadow>
          <torusGeometry args={[0.07, 0.018, 5, 12, Math.PI]} />
          <meshStandardMaterial color="#e5d6bd" roughness={1} />
        </mesh>
      ))}
      {/* A folded blanket poking out from under the lid. */}
      <mesh position={[-0.16, 0.64, 0.08]} rotation={[0, 0.3, -0.12]} castShadow>
        <boxGeometry args={[0.2, 0.06, 0.16]} />
        <meshStandardMaterial color="#8fa9a2" roughness={1} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------------- 廚房・餐廳 */

/** 島型吧台 — a kitchen island with a breakfast overhang, two stools and a hanging rail. */
function KitchenIslandModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Cabinet block. */}
      <mesh position={[0, 0.46, -0.06]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.9, 0.62]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.7} />
      </mesh>
      {/* Toe kick, recessed. */}
      <mesh position={[0, 0.04, -0.06]} castShadow>
        <boxGeometry args={[1.6, 0.08, 0.54]} />
        <meshStandardMaterial color="#2c4f4b" roughness={0.8} />
      </mesh>
      {/* Three door panels with slim pulls. */}
      {[-0.55, 0, 0.55].map((x) => (
        <React.Fragment key={`door-${x}`}>
          <mesh position={[x, 0.5, 0.256]} castShadow>
            <boxGeometry args={[0.5, 0.74, 0.025]} />
            <meshStandardMaterial color="#4a7f79" roughness={0.68} />
          </mesh>
          <mesh position={[x + 0.2, 0.5, 0.278]} castShadow>
            <boxGeometry args={[0.025, 0.3, 0.025]} />
            <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Stone worktop, overhanging at the front to make the bar. */}
      <mesh position={[0, 0.94, 0.04]} castShadow receiveShadow>
        <boxGeometry args={[1.86, 0.08, 0.92]} />
        <meshStandardMaterial color="#e6e1d7" roughness={0.4} />
      </mesh>
      {/* Two bar stools tucked under the overhang. */}
      {[-0.42, 0.42].map((x) => (
        <group key={`stool-${x}`} position={[x, 0, 0.52]}>
          <mesh position={[0, 0.02, 0]} castShadow>
            <cylinderGeometry args={[0.17, 0.19, 0.04, 12]} />
            <meshStandardMaterial color="#6b6257" metalness={0.4} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.32, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.045, 0.6, 8]} />
            <meshStandardMaterial color="#8e9aa0" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.13, 0.016, 5, 12]} />
            <meshStandardMaterial color="#8e9aa0" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.65, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.06, 12]} />
            <meshStandardMaterial color="#b98a52" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* A rail on the end with two utensils hanging off it. */}
      <mesh position={[-0.93, 0.66, -0.06]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.5, 8]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
      </mesh>
      {[-0.14, 0.1].map((z, i) => (
        <mesh key={`util-${i}`} position={[-0.93, 0.53, z]} castShadow>
          <boxGeometry args={[0.03, 0.22, 0.06]} />
          <meshStandardMaterial color="#b8bec4" metalness={0.55} roughness={0.4} />
        </mesh>
      ))}
      {/* A bowl and a board on the worktop. */}
      <mesh position={[0.5, 1.02, -0.1]} castShadow>
        <cylinderGeometry args={[0.16, 0.1, 0.09, 12]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.5} />
      </mesh>
      <mesh position={[-0.45, 1.0, -0.06]} rotation={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.42, 0.03, 0.28]} />
        <meshStandardMaterial color="#c19a63" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** 廚房收納櫃 — a tall larder: two glazed doors above, two solid below, jars visible. */
function PantryCabinetModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Carcass and cornice. */}
      <mesh position={[0, 1.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.06, 2.0, 0.46]} />
        <meshStandardMaterial color="#efe4d2" roughness={0.85} />
      </mesh>
      <mesh position={[0, 2.11, 0]} castShadow>
        <boxGeometry args={[1.14, 0.1, 0.52]} />
        <meshStandardMaterial color="#d9c3a5" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[1.02, 0.1, 0.42]} />
        <meshStandardMaterial color="#d9c3a5" roughness={0.85} />
      </mesh>
      {/* Middle rail splitting glazed from solid. */}
      <mesh position={[0, 1.02, 0.236]} castShadow>
        <boxGeometry args={[1.04, 0.09, 0.03]} />
        <meshStandardMaterial color="#d9c3a5" roughness={0.85} />
      </mesh>
      {/* Two glazed upper doors, each with a muntin cross. */}
      {[-0.26, 0.26].map((x) => (
        <React.Fragment key={`up-${x}`}>
          <mesh position={[x, 1.58, 0.232]}>
            <boxGeometry args={[0.46, 1.0, 0.015]} />
            <meshStandardMaterial color="#dbeefb" transparent opacity={0.26} roughness={0.05} />
          </mesh>
          <mesh position={[x, 1.58, 0.242]} castShadow>
            <boxGeometry args={[0.03, 1.0, 0.02]} />
            <meshStandardMaterial color="#e6d9c4" roughness={0.85} />
          </mesh>
          <mesh position={[x, 1.58, 0.242]} castShadow>
            <boxGeometry args={[0.46, 0.03, 0.02]} />
            <meshStandardMaterial color="#e6d9c4" roughness={0.85} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Shelves and jars behind the glass. */}
      {[1.28, 1.62, 1.96].map((y, i) => (
        <mesh key={`sh-${i}`} position={[0, y, 0.02]} receiveShadow>
          <boxGeometry args={[0.94, 0.03, 0.36]} />
          <meshStandardMaterial color="#e6d9c4" roughness={0.85} />
        </mesh>
      ))}
      {[
        [-0.3, 1.36, '#c9836f'], [-0.1, 1.36, '#8fa9a2'], [0.12, 1.36, '#e8c37a'],
        [-0.22, 1.7, '#9db8b0'], [0.06, 1.7, '#c2703d'], [0.28, 1.7, '#cfe3e0'],
      ].map(([x, y, c], i) => (
        <mesh key={`jar-${i}`} position={[x as number, y as number, 0.02]} castShadow>
          <cylinderGeometry args={[0.055, 0.05, 0.14, 10]} />
          <meshStandardMaterial color={c as string} roughness={0.5} />
        </mesh>
      ))}
      {/* Two solid lower doors. */}
      {[-0.26, 0.26].map((x) => (
        <React.Fragment key={`low-${x}`}>
          <mesh position={[x, 0.54, 0.238]} castShadow>
            <boxGeometry args={[0.46, 0.84, 0.025]} />
            <meshStandardMaterial color="#f7f1e6" roughness={0.85} />
          </mesh>
          {/* Shaker inset panel. */}
          <mesh position={[x, 0.54, 0.248]}>
            <boxGeometry args={[0.34, 0.7, 0.01]} />
            <meshStandardMaterial color="#e9dcc7" roughness={0.88} />
          </mesh>
          <mesh position={[x + (x > 0 ? -0.18 : 0.18), 0.54, 0.268]}>
            <sphereGeometry args={[0.026, 8, 6]} />
            <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
          </mesh>
        </React.Fragment>
      ))}
    </group>
  );
}

/** 微波爐 — a countertop microwave: door with a dark window, a keypad, a handle. */
/**
 * 微波爐 —— the piece that had to grow an INSIDE.
 *
 * Its body was one solid 0.72 × 0.32 × 0.46 box, so a door that opened would have opened onto a
 * grey slab, and a turntable would have had nowhere to turn. It is now a shell of five panels
 * whose union has exactly the same outer extent — the same trick, and for exactly the same
 * reason, as the bathtub above: every collider in the game is measured off the model
 * (lib/furniturePlacement.ts), so keeping the extent identical means nothing about where this
 * piece may be placed changes at all. What changed is that there is now a cavity.
 *
 * The window is tinted-transparent rather than opaque, so the plate turning and the cavity light
 * read from the front while the door is shut — which is what a microwave actually looks like
 * mid-cycle, and is why the door only needs to open for the first second of the run.
 */
function MicrowaveModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Shell: back, both sides, top and bottom. Same box as before, now hollow. */}
      <mesh position={[0, 0.18, -0.21]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.32, 0.04]} />
        <meshStandardMaterial color="#dfe3e6" metalness={0.25} roughness={0.5} />
      </mesh>
      <mesh position={[0.245, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.23, 0.32, 0.46]} />
        <meshStandardMaterial color="#dfe3e6" metalness={0.25} roughness={0.5} />
      </mesh>
      <mesh position={[-0.335, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.05, 0.32, 0.46]} />
        <meshStandardMaterial color="#dfe3e6" metalness={0.25} roughness={0.5} />
      </mesh>
      {[0.32, 0.04].map((y, i) => (
        <mesh key={`shell-${i}`} position={[-0.09, y, 0.02]} castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.04, 0.42]} />
          <meshStandardMaterial color="#dfe3e6" metalness={0.25} roughness={0.5} />
        </mesh>
      ))}
      {/* The cavity's own walls, a shade darker so the inside reads as an inside. */}
      <mesh position={[-0.09, 0.18, -0.185]}>
        <boxGeometry args={[0.44, 0.24, 0.012]} />
        <meshStandardMaterial color="#9aa4a8" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* The turntable, and a mug on it so the rotation is legible at all. */}
      <group position={[-0.09, 0.075, 0.01]} ref={anim.ref('plate')}>
        <mesh>
          <cylinderGeometry args={[0.11, 0.11, 0.012, 14]} />
          <meshStandardMaterial color="#e8eef0" roughness={0.25} metalness={0.1} transparent opacity={0.9} />
        </mesh>
        <mesh position={[0.045, 0.045, 0]}>
          <cylinderGeometry args={[0.038, 0.032, 0.075, 10]} />
          <meshStandardMaterial color="#3f6f6a" roughness={0.6} />
        </mesh>
      </group>
      {anim.active && (
        <GlowPanel position={[-0.09, 0.18, -0.175]} size={[0.42, 0.22]} color="#ffe6a8" intensity={2.2} />
      )}
      {/* Door with a tinted window and a grille pattern, hinged on its own -X edge. */}
      <group position={[-0.35, 0.18, 0.238]} ref={anim.ref('door')}>
        <mesh position={[0.26, 0, 0]} castShadow>
          <boxGeometry args={[0.52, 0.27, 0.02]} />
          <meshStandardMaterial color="#c7cdd1" metalness={0.3} roughness={0.45} />
        </mesh>
        {/* Tinted, but genuinely see-through: at 0.62 over a near-black tint the lit cavity
            behind it did not read at all, so a running microwave with its door shut looked
            identical to one that was off. */}
        <mesh position={[0.26, 0, 0.014]}>
          <boxGeometry args={[0.42, 0.2, 0.012]} />
          <meshStandardMaterial color="#43535c" roughness={0.3} metalness={0.2} transparent opacity={0.4} />
        </mesh>
        {[-0.06, 0.0, 0.06].map((dy, i) => (
          <mesh key={`grille-${i}`} position={[0.26, dy, 0.022]}>
            <boxGeometry args={[0.4, 0.008, 0.006]} />
            <meshStandardMaterial color="#4b5563" roughness={0.5} />
          </mesh>
        ))}
        {/* Handle. */}
        <mesh position={[0.54, 0, 0.032]} castShadow>
          <boxGeometry args={[0.03, 0.24, 0.035]} />
          <meshStandardMaterial color="#8e9aa0" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
      {/* Control panel: a green readout and a knob. */}
      <mesh position={[0.28, 0.26, 0.238]}>
        <boxGeometry args={[0.14, 0.06, 0.015]} />
        <meshStandardMaterial color="#1f2937" roughness={0.4} />
      </mesh>
      <mesh position={[0.28, 0.26, 0.248]}>
        <boxGeometry args={[0.1, 0.03, 0.008]} />
        <meshStandardMaterial color="#7ff0dd" emissive="#3fd8c0" emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0.28, 0.12, 0.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.03, 12]} />
        <meshStandardMaterial color="#9aa4a8" metalness={0.4} roughness={0.45} />
      </mesh>
      {/* Feet. */}
      {[-0.3, 0.3].map((x) => [-0.18, 0.18].map((z) => (
        <mesh key={`foot-${x}-${z}`} position={[x, 0.015, z]} castShadow>
          <cylinderGeometry args={[0.022, 0.02, 0.03, 6]} />
          <meshStandardMaterial color="#4b5563" roughness={0.7} />
        </mesh>
      )))}
    </group>
  );
}

/**
 * 烤箱 — a freestanding double oven: two glazed doors, a rail handle each, four dials.
 *
 * The upper door is a DROP-FRONT: hinged along its own bottom edge (y = 0.37) and turned about X,
 * which is the only direction an oven door goes and the reason this one part could not have
 * reused the side-hung `hinge` the fridge and the wardrobe use — same motion, different axis,
 * one word of data apart.
 */
function OvenModel({ scale, item, instanceId }: FurnitureModelProps) {
  const anim = useObjectAnimation(instanceId, item);
  return (
    <group ref={anim.root} scale={scale}>
      {/* Body. */}
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.74, 0.88, 0.64]} />
        <meshStandardMaterial color="#c7cdd1" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* What the open door reveals: a lit cavity with a shelf and a tray on it, plus the heat
          coming off it. Mounted by state, so a shut oven draws none of it. */}
      {anim.active && (
        <>
          {/* The lit back of the cavity sits BEHIND the shelf and the tray, not in front of
              them: a glow panel at the door plane is a lightbox, and it hides the two objects
              that make the cavity read as an oven. */}
          <GlowPanel position={[0, 0.6, 0.28]} size={[0.46, 0.3]} color="#ffbe6a" intensity={0.75} cast={0.35} />
          <mesh position={[0, 0.52, 0.31]}>
            <boxGeometry args={[0.46, 0.012, 0.06]} />
            <meshStandardMaterial color="#6b7280" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.56, 0.31]} castShadow>
            <boxGeometry args={[0.2, 0.06, 0.1]} />
            <meshStandardMaterial color="#c9836f" roughness={0.85} />
          </mesh>
          <SteamWisps at={[0, 0.86, 0.34]} rise={0.34} spread={0.13} count={4} size={0.026} color="#f7ead9" />
        </>
      )}
      {/* The lower door and its handle — fixed; only the baking compartment opens. */}
      <mesh position={[0, 0.24, 0.33]} castShadow>
        <boxGeometry args={[0.68, 0.22, 0.03]} />
        <meshStandardMaterial color="#aab3b8" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.24, 0.348]}>
        <boxGeometry args={[0.54, 0.12, 0.012]} />
        <meshStandardMaterial color="#33403f" roughness={0.25} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.3, 0.4]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, 0.62, 8]} />
        <meshStandardMaterial color="#8e9aa0" metalness={0.55} roughness={0.35} />
      </mesh>
      {/* The baking compartment's door, hinged along its own bottom edge. */}
      <group position={[0, 0.37, 0.33]} ref={anim.ref('doorUpper')}>
        <mesh position={[0, 0.23, 0]} castShadow>
          <boxGeometry args={[0.68, 0.46, 0.03]} />
          <meshStandardMaterial color="#aab3b8" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.23, 0.018]}>
          <boxGeometry args={[0.54, 0.36, 0.012]} />
          <meshStandardMaterial color="#33403f" roughness={0.25} metalness={0.15} transparent opacity={0.82} />
        </mesh>
        {/* A warm glow behind the upper glass — something is baking. */}
        <mesh position={[0, 0.23, -0.008]}>
          <boxGeometry args={[0.5, 0.32, 0.01]} />
          <meshStandardMaterial color="#ffb347" emissive="#ff9c33" emissiveIntensity={0.7} />
        </mesh>
        {/* Rail handle on standoffs. */}
        <mesh position={[0, 0.41, 0.07]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.62, 8]} />
          <meshStandardMaterial color="#8e9aa0" metalness={0.55} roughness={0.35} />
        </mesh>
      </group>
      {/* Control panel with four dials. */}
      <mesh position={[0, 0.85, 0.33]} castShadow>
        <boxGeometry args={[0.72, 0.12, 0.03]} />
        <meshStandardMaterial color="#5b6469" metalness={0.4} roughness={0.5} />
      </mesh>
      {[-0.24, -0.08, 0.08, 0.24].map((x) => (
        <mesh key={`dial-${x}`} position={[x, 0.85, 0.36]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.03, 10]} />
          <meshStandardMaterial color="#c8a24a" metalness={0.45} roughness={0.4} />
        </mesh>
      ))}
      {/* Hob top: four rings. */}
      <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.05, 0.66]} />
        <meshStandardMaterial color="#3f474b" roughness={0.35} />
      </mesh>
      {[-0.18, 0.18].map((x) => [-0.15, 0.15].map((z) => (
        <mesh key={`ring-${x}-${z}`} position={[x, 0.93, z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.11, 0.014, 5, 14]} />
          <meshStandardMaterial color="#8e9aa0" metalness={0.5} roughness={0.4} />
        </mesh>
      )))}
    </group>
  );
}

/** 餐具架 — a two-tier draining rack with plates on edge, mugs hanging, a drip tray. */
function DishRackModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Drip tray. */}
      <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.05, 0.42]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.55} />
      </mesh>
      {/* Four corner posts. */}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`post-${sx}-${sz}`} position={[sx * 0.28, 0.3, sz * 0.18]} castShadow>
          <cylinderGeometry args={[0.014, 0.014, 0.54, 6]} />
          <meshStandardMaterial color="#b8bec4" metalness={0.5} roughness={0.4} />
        </mesh>
      )))}
      {/* Lower rack: eight wires the plates stand between. */}
      {[-0.21, -0.15, -0.09, -0.03, 0.03, 0.09, 0.15, 0.21].map((x) => (
        <mesh key={`wire-${x}`} position={[x, 0.14, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.008, 0.008, 0.34, 5]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {/* Three plates standing on edge. */}
      {[-0.18, -0.06, 0.06].map((x, i) => (
        <mesh key={`plate-${i}`} position={[x, 0.26, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.022, 14]} />
          <meshStandardMaterial color={['#f7f3ea', '#cfe3e0', '#f7f3ea'][i]} roughness={0.5} />
        </mesh>
      ))}
      {/* Upper shelf. */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.02, 0.38]} />
        <meshStandardMaterial color="#b8bec4" metalness={0.45} roughness={0.4} />
      </mesh>
      {/* Two mugs hanging off the front edge by their handles. */}
      {[-0.16, 0.16].map((x, i) => (
        <group key={`mug-${i}`} position={[x, 0.46, 0.16]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.055, 0.05, 0.1, 10]} />
            <meshStandardMaterial color={i ? '#c9836f' : '#3f6f6a'} roughness={0.5} />
          </mesh>
          <mesh position={[0.07, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.028, 0.009, 5, 10]} />
            <meshStandardMaterial color={i ? '#c9836f' : '#3f6f6a'} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* A cutlery cup on the top shelf. */}
      <mesh position={[0.22, 0.62, -0.08]} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.12, 10]} />
        <meshStandardMaterial color="#dfe3e6" metalness={0.4} roughness={0.45} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`fork-${i}`} position={[0.22 + (i - 1) * 0.018, 0.72, -0.08]} rotation={[0, 0, (i - 1) * 0.18]} castShadow>
          <boxGeometry args={[0.012, 0.12, 0.012]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------------ 小型裝飾 */

/** 陶瓷花瓶 — a hand-thrown bulbous vase with three stems, throwing rings visible. */
function CeramicVaseModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Foot, belly, shoulder, neck — four sections, which is what makes it thrown. */}
      <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.11, 0.05, 12]} />
        <meshStandardMaterial color="#cfe3e0" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow>
        <sphereGeometry args={[0.17, 14, 10]} />
        <meshStandardMaterial color="#dfeeea" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.14, 0.12, 12]} />
        <meshStandardMaterial color="#dfeeea" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.068, 0.1, 12]} />
        <meshStandardMaterial color="#cfe3e0" roughness={0.45} />
      </mesh>
      {/* Two throwing rings around the belly. */}
      {[0.12, 0.2].map((y) => (
        <mesh key={`ring-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.168, 0.006, 5, 18]} />
          <meshStandardMaterial color="#b9d2cd" roughness={0.5} />
        </mesh>
      ))}
      {/* Three stems with leaves. */}
      {[-0.28, 0.05, 0.34].map((tilt, i) => (
        <group key={`stem-${i}`} position={[0, 0.44, 0]} rotation={[0, i * 1.9, tilt]}>
          <mesh position={[0, 0.16, 0]} castShadow>
            <cylinderGeometry args={[0.008, 0.01, 0.32, 5]} />
            <meshStandardMaterial color="#5b7f4a" roughness={0.9} />
          </mesh>
          <mesh position={[0.05, 0.24, 0]} rotation={[0, 0, -0.7]} castShadow>
            <capsuleGeometry args={[0.03, 0.09, 3, 6]} />
            <meshStandardMaterial color="#6b9459" roughness={0.9} />
          </mesh>
          <mesh position={[-0.04, 0.3, 0.01]} rotation={[0, 0, 0.8]} castShadow>
            <capsuleGeometry args={[0.026, 0.08, 3, 6]} />
            <meshStandardMaterial color="#5b7f4a" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** 木質相框 — a leaning photo frame with a mount board and a simple beach picture. */
function PhotoFrameModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      <group rotation={[0.2, 0, 0]}>
        {/* Frame members. */}
        {[-0.16, 0.16].map((x) => (
          <mesh key={`s-${x}`} position={[x, 0.22, 0]} castShadow>
            <boxGeometry args={[0.035, 0.44, 0.03]} />
            <meshStandardMaterial color="#b98a52" roughness={0.8} />
          </mesh>
        ))}
        {[0.02, 0.42].map((y) => (
          <mesh key={`r-${y}`} position={[0, y, 0]} castShadow>
            <boxGeometry args={[0.36, 0.035, 0.03]} />
            <meshStandardMaterial color="#b98a52" roughness={0.8} />
          </mesh>
        ))}
        {/* Cream mount, then the picture inside it. */}
        <mesh position={[0, 0.22, -0.005]}>
          <boxGeometry args={[0.3, 0.38, 0.015]} />
          <meshStandardMaterial color="#f7f3ea" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.24, 0.006]}>
          <boxGeometry args={[0.22, 0.26, 0.008]} />
          <meshStandardMaterial color="#8fc4d8" roughness={0.8} />
        </mesh>
        {/* Sea, sand and a sun — three rectangles that read as a beach at thumbnail size. */}
        <mesh position={[0, 0.19, 0.011]}>
          <boxGeometry args={[0.21, 0.08, 0.006]} />
          <meshStandardMaterial color="#3f8fa8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.14, 0.011]}>
          <boxGeometry args={[0.2, 0.06, 0.006]} />
          <meshStandardMaterial color="#e8d5a8" roughness={0.9} />
        </mesh>
        <mesh position={[0.06, 0.31, 0.011]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.006, 10]} />
          <meshStandardMaterial color="#f5c76a" emissive="#f0b429" emissiveIntensity={0.3} />
        </mesh>
      </group>
      {/* Kickstand at the back. */}
      <mesh position={[0, 0.16, -0.13]} rotation={[-0.42, 0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.32, 0.02]} />
        <meshStandardMaterial color="#8a6435" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** 香氛蠟燭 — three pillar candles of different heights on a slate coaster, one lit. */
function CandleSetModel({ scale, item }: FurnitureModelProps) {
  const CANDLES = [
    { x: -0.12, z: 0.02, h: 0.26, r: 0.065, color: '#f7f3ea', lit: true },
    { x: 0.06, z: -0.08, h: 0.18, r: 0.055, color: '#efe0c8', lit: false },
    { x: 0.13, z: 0.08, h: 0.13, r: 0.05, color: '#e8d5c0', lit: true },
  ];
  return (
    <group scale={scale}>
      {/* Slate coaster. */}
      <mesh position={[0, 0.012, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.29, 0.024, 14]} />
        <meshStandardMaterial color="#6f7a80" roughness={0.9} />
      </mesh>
      {CANDLES.map((c, i) => (
        <group key={`c-${i}`} position={[c.x, 0.024, c.z]}>
          <mesh position={[0, c.h / 2, 0]} castShadow>
            <cylinderGeometry args={[c.r, c.r, c.h, 12]} />
            <meshStandardMaterial color={c.color} roughness={0.85} />
          </mesh>
          {/* Melted rim — a slightly wider, slightly lower disc at the top. */}
          <mesh position={[0, c.h - 0.012, 0]}>
            <cylinderGeometry args={[c.r + 0.004, c.r, 0.016, 12]} />
            <meshStandardMaterial color="#e6dcc8" roughness={0.7} />
          </mesh>
          <mesh position={[0, c.h + 0.012, 0]}>
            <cylinderGeometry args={[0.004, 0.004, 0.024, 4]} />
            <meshStandardMaterial color="#3f3a2c" roughness={0.9} />
          </mesh>
          {c.lit && (
            <mesh position={[0, c.h + 0.045, 0]}>
              <coneGeometry args={[0.022, 0.06, 6]} />
              <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.6} />
            </mesh>
          )}
        </group>
      ))}
      {/* Two dried sprigs laid on the coaster. */}
      {[-0.5, 0.9].map((rot, i) => (
        <mesh key={`sprig-${i}`} position={[0.02 + i * 0.04, 0.03, 0.18 - i * 0.04]} rotation={[0, rot, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.008, 0.14, 3, 5]} />
          <meshStandardMaterial color="#9c8060" roughness={0.95} />
        </mesh>
      ))}
      {/* A flame: burns whatever the wall switch says. */}
      <FixtureLight item={item} position={[-0.12, 0.34, 0.02]} />
    </group>
  );
}

/** 小型時鐘 — a round table clock in a wooden case, with real hands and two bell feet. */
function TableClockModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Case: a ring with a face inset. */}
      <mesh position={[0, 0.24, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.21, 0.21, 0.09, 18]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.24, 0.048]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.175, 0.175, 0.012, 18]} />
        <meshStandardMaterial color="#f7f3ea" roughness={0.75} />
      </mesh>
      {/* Twelve ticks — four long, eight short. */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const long = i % 3 === 0;
        return (
          <mesh
            key={`tick-${i}`}
            position={[Math.sin(a) * 0.145, 0.24 + Math.cos(a) * 0.145, 0.056]}
            rotation={[0, 0, -a]}
          >
            <boxGeometry args={[0.012, long ? 0.038 : 0.022, 0.006]} />
            <meshStandardMaterial color="#3f3a2c" roughness={0.8} />
          </mesh>
        );
      })}
      {/* Hands, at ten past ten. */}
      <mesh position={[-0.035, 0.276, 0.062]} rotation={[0, 0, 0.9]}>
        <boxGeometry args={[0.012, 0.1, 0.006]} />
        <meshStandardMaterial color="#3f3a2c" roughness={0.7} />
      </mesh>
      <mesh position={[0.045, 0.29, 0.062]} rotation={[0, 0, -1.0]}>
        <boxGeometry args={[0.01, 0.13, 0.006]} />
        <meshStandardMaterial color="#3f3a2c" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.24, 0.066]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.01, 8]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Two bells on top and two little feet. */}
      {[-0.13, 0.13].map((x) => (
        <mesh key={`bell-${x}`} position={[x, 0.42, 0]} rotation={[0, 0, x > 0 ? -0.3 : 0.3]} castShadow>
          <sphereGeometry args={[0.06, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#c8a24a" metalness={0.55} roughness={0.35} />
        </mesh>
      ))}
      {[-0.12, 0.12].map((x) => (
        <mesh key={`foot-${x}`} position={[x, 0.03, 0]} rotation={[0, 0, x > 0 ? -0.35 : 0.35]} castShadow>
          <cylinderGeometry args={[0.022, 0.03, 0.08, 8]} />
          <meshStandardMaterial color="#8a6435" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** 抱枕組 — 可愛生活系列. Three cushions of different fabrics leaning on each other. */
function CushionSetModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Back cushion, standing upright. */}
      <mesh position={[-0.02, 0.24, -0.08]} rotation={[0.16, 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.46, 0.14]} />
        <meshStandardMaterial color="#8fa9a2" roughness={0.98} />
      </mesh>
      {/* Its four corner tufts. */}
      {[-1, 1].map((sx) => [-1, 1].map((sy) => (
        <mesh key={`t-${sx}-${sy}`} position={[-0.02 + sx * 0.19, 0.24 + sy * 0.19, -0.005]} castShadow>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color="#7a978f" roughness={1} />
        </mesh>
      )))}
      {/* Middle cushion, leaning against it, striped. */}
      <mesh position={[0.14, 0.19, 0.06]} rotation={[0.3, -0.3, 0.1]} castShadow>
        <boxGeometry args={[0.38, 0.38, 0.13]} />
        <meshStandardMaterial color="#e8d5c0" roughness={0.98} />
      </mesh>
      {[-0.1, 0, 0.1].map((dy, i) => (
        <mesh key={`stripe-${i}`} position={[0.14, 0.19 + dy, 0.125]} rotation={[0.3, -0.3, 0.1]}>
          <boxGeometry args={[0.36, 0.05, 0.01]} />
          <meshStandardMaterial color="#c9836f" roughness={0.98} />
        </mesh>
      ))}
      {/* Front bolster, lying down. */}
      <mesh position={[-0.14, 0.1, 0.16]} rotation={[0, 0.34, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.4, 12]} />
        <meshStandardMaterial color="#e8a09a" roughness={0.98} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`cap-${s}`} position={[-0.14 + s * 0.19, 0.1, 0.16 + s * 0.068]} rotation={[0, 0.34, Math.PI / 2]} castShadow>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshStandardMaterial color="#d68f89" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** 玩偶 — 可愛生活系列. A little knitted bear sitting down, one ear stitched a bit crooked. */
function PlushToyModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Two legs out in front. */}
      {[-0.09, 0.09].map((x) => (
        <mesh key={`leg-${x}`} position={[x, 0.07, 0.09]} rotation={[Math.PI / 2 - 0.3, 0, 0]} castShadow>
          <capsuleGeometry args={[0.06, 0.09, 4, 8]} />
          <meshStandardMaterial color="#c9a48a" roughness={1} />
        </mesh>
      ))}
      {/* Body, slightly egg-shaped. */}
      <mesh position={[0, 0.19, 0]} scale={[1, 1.15, 0.95]} castShadow receiveShadow>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color="#c9a48a" roughness={1} />
      </mesh>
      {/* Belly patch. */}
      <mesh position={[0, 0.17, 0.11]} scale={[1, 1.1, 0.5]} castShadow>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color="#e8d5c0" roughness={1} />
      </mesh>
      {/* Arms. */}
      {[-1, 1].map((s) => (
        <mesh key={`arm-${s}`} position={[s * 0.15, 0.2, 0.04]} rotation={[0.3, 0, -s * 0.6]} castShadow>
          <capsuleGeometry args={[0.045, 0.08, 4, 8]} />
          <meshStandardMaterial color="#c9a48a" roughness={1} />
        </mesh>
      ))}
      {/* Head. */}
      <mesh position={[0, 0.4, 0.01]} castShadow>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color="#d6b296" roughness={1} />
      </mesh>
      {/* Muzzle. */}
      <mesh position={[0, 0.37, 0.11]} scale={[1.1, 0.8, 0.8]} castShadow>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color="#efe0cd" roughness={1} />
      </mesh>
      <mesh position={[0, 0.39, 0.155]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#5b4636" roughness={0.8} />
      </mesh>
      {/* Eyes — two stitched dots. */}
      {[-0.05, 0.05].map((x) => (
        <mesh key={`eye-${x}`} position={[x, 0.44, 0.115]}>
          <sphereGeometry args={[0.016, 8, 6]} />
          <meshStandardMaterial color="#3f3a2c" roughness={0.7} />
        </mesh>
      ))}
      {/* Ears — the right one deliberately a little higher and turned, so it reads as handmade. */}
      <mesh position={[-0.1, 0.5, 0.0]} castShadow>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color="#c9a48a" roughness={1} />
      </mesh>
      <mesh position={[0.1, 0.52, -0.01]} rotation={[0, 0, 0.3]} castShadow>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color="#c9a48a" roughness={1} />
      </mesh>
      {/* A little scarf. */}
      <mesh position={[0, 0.29, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.105, 0.026, 6, 14]} />
        <meshStandardMaterial color="#c9836f" roughness={1} />
      </mesh>
      <mesh position={[0.09, 0.24, 0.08]} rotation={[0.3, 0, 0.5]} castShadow>
        <boxGeometry args={[0.05, 0.12, 0.03]} />
        <meshStandardMaterial color="#c9836f" roughness={1} />
      </mesh>
    </group>
  );
}

/** 小鯨魚雕像 — a carved driftwood whale on a wave-shaped plinth. */
function WhaleFigurineModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Plinth, carved as two overlapping waves. */}
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.44, 0.06, 0.2]} />
        <meshStandardMaterial color="#8a6435" roughness={0.9} />
      </mesh>
      {[-0.1, 0.1].map((x, i) => (
        <mesh key={`wave-${i}`} position={[x, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.18, 10, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#7fa8a0" roughness={0.75} />
        </mesh>
      ))}
      {/* Body — a stretched sphere, nose to the right. */}
      <mesh position={[0.02, 0.2, 0]} scale={[1.5, 0.85, 0.9]} castShadow>
        <sphereGeometry args={[0.15, 14, 10]} />
        <meshStandardMaterial color="#5f7f8c" roughness={0.6} />
      </mesh>
      {/* Pale underside. */}
      <mesh position={[0.02, 0.15, 0.0]} scale={[1.35, 0.42, 0.7]} castShadow>
        <sphereGeometry args={[0.14, 12, 8]} />
        <meshStandardMaterial color="#dfeaee" roughness={0.7} />
      </mesh>
      {/* Tail flukes. */}
      {[-1, 1].map((s) => (
        <mesh key={`fluke-${s}`} position={[-0.26, 0.24, s * 0.05]} rotation={[0, s * 0.5, 0.5]} castShadow>
          <coneGeometry args={[0.06, 0.16, 4]} />
          <meshStandardMaterial color="#4f6c78" roughness={0.6} />
        </mesh>
      ))}
      {/* Pectoral fin. */}
      <mesh position={[0.04, 0.16, 0.12]} rotation={[0.4, 0, -0.3]} castShadow>
        <coneGeometry args={[0.045, 0.12, 4]} />
        <meshStandardMaterial color="#4f6c78" roughness={0.6} />
      </mesh>
      {/* Eye and a carved smile line. */}
      <mesh position={[0.18, 0.22, 0.075]}>
        <sphereGeometry args={[0.016, 8, 6]} />
        <meshStandardMaterial color="#2f3a40" roughness={0.6} />
      </mesh>
      {/* Spout — three little beads, because a whale statue without one is just a fish. */}
      {[0, 1, 2].map((i) => (
        <mesh key={`spout-${i}`} position={[0.06, 0.32 + i * 0.045, (i - 1) * 0.02]} castShadow>
          <sphereGeometry args={[0.028 - i * 0.005, 8, 6]} />
          <meshStandardMaterial color="#cfe3e0" transparent opacity={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** 書本堆 — five books stacked slightly out of true, with a bookmark and reading glasses. */
function BookStackModel({ scale }: FurnitureModelProps) {
  const BOOKS = [
    { y: 0.03, w: 0.34, d: 0.26, h: 0.06, rot: 0.0, color: '#3f6f6a' },
    { y: 0.095, w: 0.32, d: 0.24, h: 0.055, rot: 0.16, color: '#c9836f' },
    { y: 0.155, w: 0.33, d: 0.25, h: 0.05, rot: -0.1, color: '#e8c37a' },
    { y: 0.21, w: 0.3, d: 0.23, h: 0.048, rot: 0.24, color: '#8fa9a2' },
    { y: 0.26, w: 0.31, d: 0.24, h: 0.045, rot: -0.06, color: '#9c7fb8' },
  ];
  return (
    <group scale={scale}>
      {BOOKS.map((b, i) => (
        <group key={`b-${i}`} position={[0, b.y, 0]} rotation={[0, b.rot, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.color} roughness={0.85} />
          </mesh>
          {/* Cream page block, inset on three sides so the cover reads as a cover. */}
          <mesh position={[0.006, 0, 0]}>
            <boxGeometry args={[b.w - 0.02, b.h - 0.014, b.d - 0.014]} />
            <meshStandardMaterial color="#f4ecd8" roughness={0.9} />
          </mesh>
          {/* Spine band. */}
          <mesh position={[-b.w / 2 + 0.004, 0, 0]}>
            <boxGeometry args={[0.012, b.h + 0.004, b.d + 0.004]} />
            <meshStandardMaterial color={b.color} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* A ribbon bookmark hanging out of the third book. */}
      <mesh position={[0.12, 0.155, 0.14]} rotation={[0, -0.1, 0]} castShadow>
        <boxGeometry args={[0.03, 0.006, 0.12]} />
        <meshStandardMaterial color="#dc2626" roughness={0.9} />
      </mesh>
      {/* Reading glasses folded on top. */}
      {[-0.07, 0.07].map((x) => (
        <mesh key={`lens-${x}`} position={[x, 0.29, 0.02]} rotation={[Math.PI / 2, 0, 0.1]} castShadow>
          <torusGeometry args={[0.045, 0.008, 5, 12]} />
          <meshStandardMaterial color="#6b6257" metalness={0.35} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.29, 0.02]} rotation={[0, 0, 0.1]}>
        <boxGeometry args={[0.05, 0.006, 0.006]} />
        <meshStandardMaterial color="#6b6257" metalness={0.35} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** 桌上收納盒 — a compartmented desk caddy with pens, scissors and a roll of tape. */
function DeskOrganizerModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Tray base. */}
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.44, 0.04, 0.26]} />
        <meshStandardMaterial color="#b98a52" roughness={0.85} />
      </mesh>
      {/* Outer walls. */}
      {[-0.21, 0.21].map((x) => (
        <mesh key={`w-${x}`} position={[x, 0.09, 0]} castShadow>
          <boxGeometry args={[0.025, 0.14, 0.25]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
      ))}
      {[-0.12, 0.12].map((z) => (
        <mesh key={`w2-${z}`} position={[0, 0.09, z]} castShadow>
          <boxGeometry args={[0.43, 0.135, 0.025]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
      ))}
      {/* Two dividers making three compartments. */}
      {[-0.06, 0.09].map((x) => (
        <mesh key={`div-${x}`} position={[x, 0.085, 0]} castShadow>
          <boxGeometry args={[0.018, 0.12, 0.23]} />
          <meshStandardMaterial color="#a3773f" roughness={0.85} />
        </mesh>
      ))}
      {/* Pens standing in the left bay. */}
      {[-0.16, -0.12, -0.09].map((x, i) => (
        <mesh key={`pen-${i}`} position={[x, 0.19, (i - 1) * 0.04]} rotation={[0, 0, (i - 1) * 0.18]} castShadow>
          <cylinderGeometry args={[0.01, 0.01, 0.22, 6]} />
          <meshStandardMaterial color={['#3f6f6a', '#dc2626', '#1f2937'][i]} roughness={0.7} />
        </mesh>
      ))}
      {/* Scissors in the middle bay. */}
      <mesh position={[0.02, 0.16, 0]} rotation={[0, 0, 0.1]} castShadow>
        <boxGeometry args={[0.018, 0.16, 0.03]} />
        <meshStandardMaterial color="#b8bec4" metalness={0.55} roughness={0.4} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`ring-${s}`} position={[0.02 + s * 0.015, 0.245, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.022, 0.007, 5, 10]} />
          <meshStandardMaterial color="#e8a09a" roughness={0.6} />
        </mesh>
      ))}
      {/* A roll of tape in the right bay. */}
      <mesh position={[0.15, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.05, 0.022, 6, 14]} />
        <meshStandardMaterial color="#e8c37a" transparent opacity={0.85} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** 桌上地球儀 — a tilted globe in a brass meridian ring on a turned wooden foot. */
function GlobeModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Foot. */}
      <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.18, 0.05, 14]} />
        <meshStandardMaterial color="#8a6435" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.08, 0.09, 10]} />
        <meshStandardMaterial color="#b98a52" roughness={0.8} />
      </mesh>
      {/* Meridian half-ring, tilted 23 degrees like the real thing. */}
      <group rotation={[0, 0, 0.41]}>
        <mesh position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.24, 0.016, 6, 20, Math.PI * 1.2]} />
          <meshStandardMaterial color="#c8a24a" metalness={0.55} roughness={0.35} />
        </mesh>
        {/* The sphere. */}
        <mesh position={[0, 0.36, 0]} castShadow>
          <sphereGeometry args={[0.21, 16, 12]} />
          <meshStandardMaterial color="#7fb0c8" roughness={0.6} />
        </mesh>
        {/* Four landmasses — flattened patches sitting just proud of the sea. */}
        {[
          { p: [0.1, 0.44, 0.16] as [number, number, number], s: [1.5, 1, 1.1] as [number, number, number] },
          { p: [-0.14, 0.32, 0.13] as [number, number, number], s: [1, 1.6, 0.9] as [number, number, number] },
          { p: [0.14, 0.28, -0.12] as [number, number, number], s: [1.2, 0.9, 1.3] as [number, number, number] },
          { p: [-0.06, 0.53, -0.11] as [number, number, number], s: [1.4, 0.7, 1] as [number, number, number] },
        ].map((c, i) => (
          <mesh key={`land-${i}`} position={c.p} scale={c.s} castShadow>
            <sphereGeometry args={[0.055, 8, 6]} />
            <meshStandardMaterial color={i % 2 ? '#7a9c5c' : '#8fae68'} roughness={0.8} />
          </mesh>
        ))}
        {/* Axis pins top and bottom. */}
        {[-1, 1].map((s) => (
          <mesh key={`pin-${s}`} position={[0, 0.36 + s * 0.23, 0]} castShadow>
            <cylinderGeometry args={[0.014, 0.014, 0.05, 8]} />
            <meshStandardMaterial color="#c8a24a" metalness={0.55} roughness={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** 木製畫架 — a tripod easel with a canvas half-painted and a palette hooked on. */
function EaselModel({ scale }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Two front legs and one back leg. */}
      {[-1, 1].map((s) => (
        <mesh key={`fleg-${s}`} position={[s * 0.24, 0.7, 0.16]} rotation={[-0.16, 0, -s * 0.14]} castShadow>
          <boxGeometry args={[0.05, 1.42, 0.05]} />
          <meshStandardMaterial color="#c19a63" roughness={0.88} />
        </mesh>
      ))}
      <mesh position={[0, 0.66, -0.34]} rotation={[0.34, 0, 0]} castShadow>
        <boxGeometry args={[0.05, 1.4, 0.05]} />
        <meshStandardMaterial color="#a3773f" roughness={0.88} />
      </mesh>
      {/* Cross braces. */}
      {[0.36, 0.98].map((y, i) => (
        <mesh key={`brace-${i}`} position={[0, y, 0.19 - (y - 0.7) * 0.16]} castShadow>
          <boxGeometry args={[0.5 - i * 0.08, 0.035, 0.035]} />
          <meshStandardMaterial color="#a3773f" roughness={0.88} />
        </mesh>
      ))}
      {/* Canvas shelf. */}
      <mesh position={[0, 0.62, 0.24]} castShadow>
        <boxGeometry args={[0.56, 0.05, 0.09]} />
        <meshStandardMaterial color="#8a6435" roughness={0.85} />
      </mesh>
      {/* The canvas, leaning back on the frame. */}
      <group position={[0, 0.98, 0.19]} rotation={[-0.16, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.62, 0.72, 0.035]} />
          <meshStandardMaterial color="#c19a63" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0, 0.024]}>
          <boxGeometry args={[0.56, 0.66, 0.012]} />
          <meshStandardMaterial color="#f7f3ea" roughness={0.95} />
        </mesh>
        {/* Half-finished: sky, sea, one hill. The unpainted lower band is the point. */}
        <mesh position={[0, 0.19, 0.032]}>
          <boxGeometry args={[0.54, 0.28, 0.006]} />
          <meshStandardMaterial color="#a9d3e0" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.02, 0.032]}>
          <boxGeometry args={[0.52, 0.07, 0.006]} />
          <meshStandardMaterial color="#4f8fa8" roughness={0.9} />
        </mesh>
        <mesh position={[-0.13, 0.08, 0.036]} rotation={[0, 0, 0]}>
          <coneGeometry args={[0.12, 0.14, 3]} />
          <meshStandardMaterial color="#7a9c5c" roughness={0.9} />
        </mesh>
      </group>
      {/* Palette hooked on the near leg, with three blobs of paint. */}
      <group position={[0.3, 0.72, 0.22]} rotation={[0.3, 0.3, -0.4]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.016, 12]} />
          <meshStandardMaterial color="#c9a468" roughness={0.85} />
        </mesh>
        {[['#dc2626', -0.06, 0.04], ['#2563eb', 0.05, 0.05], ['#f59e0b', 0.0, -0.07]].map(([c, x, z], i) => (
          <mesh key={`blob-${i}`} position={[x as number, 0.014, z as number]}>
            <sphereGeometry args={[0.026, 8, 6]} />
            <meshStandardMaterial color={c as string} roughness={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** 檯燈 — a small articulated desk lamp: weighted base, two arms, a tilted cone shade. */
function DeskLampModel({ scale, item }: FurnitureModelProps) {
  return (
    <group scale={scale}>
      {/* Weighted base. */}
      <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.17, 0.19, 0.05, 14]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.065, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.1, 0.04, 10]} />
        <meshStandardMaterial color="#2c4f4b" roughness={0.55} />
      </mesh>
      {/* Lower arm. */}
      <mesh position={[0.06, 0.24, 0]} rotation={[0, 0, -0.42]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.36, 8]} />
        <meshStandardMaterial color="#5f8f89" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Elbow joint. */}
      <mesh position={[0.14, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.032, 0.04, 10]} />
        <meshStandardMaterial color="#c8a24a" metalness={0.45} roughness={0.4} />
      </mesh>
      {/* Upper arm, reaching forward. */}
      <mesh position={[0.1, 0.5, 0.1]} rotation={[0.9, 0, 0.3]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.3, 8]} />
        <meshStandardMaterial color="#5f8f89" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Cone shade, tipped down over the desk. */}
      <mesh position={[0.06, 0.56, 0.22]} rotation={[1.1, 0, 0.2]} castShadow>
        <coneGeometry args={[0.14, 0.18, 14, 1, true]} />
        <meshStandardMaterial color="#3f6f6a" roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <FixtureLight item={item} position={[0.07, 0.5, 0.3]}>
        <mesh position={[0.07, 0.53, 0.26]}>
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshStandardMaterial color="#fff3d6" emissive="#ffe0a0" emissiveIntensity={1.5} />
        </mesh>
      </FixtureLight>
    </group>
  );
}

/**
 * MODEL ID -> COMPONENT. One exhaustive table, no ordering, no matching.
 *
 * This replaced an ORDERED LIST OF NAME-SUBSTRING TESTS, and the reason is worth keeping in
 * front of whoever adds the next piece. The old table's broadest rule was
 *
 *     { match: (n) => n.includes('裝飾台') || n.includes('燈'), Component: DecorLampModel }
 *
 * and it was the model for EIGHT products, because every one of 貝殼裝飾台, 復古提燈, 石製路燈,
 * 螢光石燈, 水晶吊燈, 工業風吊燈, 現代簡約吊燈 and 自然/木質吊燈 contains 燈 or 裝飾台. All eight
 * had their own carefully drawn shop icon; all eight put down the same grey cube with a glowing
 * ball. Three smaller collisions (兩張地毯, 手電筒/收音機) came from the same place.
 *
 * `Record<FurnitureModelId, …>` makes the whole class of bug unrepresentable in both directions:
 * a model id with no component is a TYPE ERROR, and a component can no longer be reached by an
 * item that merely happens to share a character with its name. What remains — two products
 * deliberately pointing at one entry — is caught by `npm run audit:shop` unless it is written
 * down in `SHARED_FURNITURE_MODELS`. See constants/furnitureModels.ts.
 */
const FURNITURE_MODELS: Record<FurnitureModelId, React.FC<FurnitureModelProps>> = {
  // ---- 廚房衛浴 ----
  'toilet': ToiletModel,
  'washbasin': WashbasinModel,
  'bathtub': BathtubModel,
  'kitchen-counter': KitchenCounterModel,
  'fridge': FridgeModel,
  'stove': StoveModel,
  'hanging-cabinet': HangingCabinetModel,
  'kitchen-island': KitchenIslandModel,
  'pantry-cabinet': PantryCabinetModel,
  'microwave': MicrowaveModel,
  'oven': OvenModel,
  'dish-rack': DishRackModel,
  'dining-chair': DiningChairModel,
  // ---- 客廳 ----
  'chair-ergonomic': ErgonomicChairModel,
  'sofa-luxury': LuxurySofaModel,
  'sofa-rattan-single': RattanArmchairModel,
  'sofa-linen-loveseat': LinenLoveseatModel,
  'sofa-l-shaped': LShapedSofaModel,
  'beanbag': BeanbagModel,
  'armchair-wing': WingArmchairModel,
  'rocking-chair': RockingChairModel,
  'tv-console': TvConsoleModel,
  'display-cabinet': DisplayCabinetModel,
  'floor-lamp-arc': ArcFloorLampModel,
  // ---- 桌子 ----
  'table-tropical': TropicalTableModel,
  'table-round-small': SmallRoundTableModel,
  'table-dining-square': SquareDiningTableModel,
  'table-dining-long': LongDiningTableModel,
  'table-coffee-round': RoundCoffeeTableModel,
  'table-side-rattan': RattanSideTableModel,
  'table-folding': FoldingTableModel,
  'table-outdoor-teak': TeakOutdoorTableModel,
  'desk-oak': DeskModel,
  'desk-work-pine': PineWorkbenchModel,
  'entryway-table': EntrywayTableModel,
  // ---- 臥室 ----
  'bed-double': DoubleBedModel,
  'bed-single-wood': SingleWoodBedModel,
  'bed-canopy-tent': CanopyTentBedModel,
  'wardrobe': WardrobeModel,
  'nightstand': NightstandModel,
  'dresser': DresserModel,
  'vanity-table': VanityTableModel,
  'mirror-standing': StandingMirrorModel,
  'coat-rack': CoatRackModel,
  // ---- 收納・書房 ----
  'bookshelf-seabreeze': BookshelfModel,
  'bookcase-ladder': LadderBookcaseModel,
  'storage-crate': StorageCrateModel,
  'rack-industrial': IndustrialRackModel,
  'wall-shelf': WallShelfModel,
  'filing-cabinet': FilingCabinetModel,
  'shell-stand': ShellDisplayStandModel,
  'storage-basket': StorageBasketModel,
  // ---- 燈具 ----
  'lantern-vintage': VintageLanternModel,
  'streetlamp-stone': StoneStreetLampModel,
  'glowstone-lamp': GlowStoneLampModel,
  'chandelier-crystal': CrystalChandelierModel,
  'pendant-industrial': IndustrialPendantModel,
  'pendant-modern': ModernPendantModel,
  'pendant-wood': WoodPendantModel,
  'wall-sconce': WallSconceModel,
  'desk-lamp': DeskLampModel,
  'torch': TorchModel,
  // ---- 小型裝飾 ----
  'flashlight-bamboo': BambooFlashlightModel,
  'radio-retro': RetroRadioModel,
  'potted-plant': PottedPlantModel,
  'surfboard': SurfboardModel,
  'rug-woven': WovenRugModel,
  'rug-boho': BohoRugModel,
  'paint-can': PaintCanModel,
  'window-view': WindowViewModel,
  'canvas-art': CanvasArtModel,
  'vase-ceramic': CeramicVaseModel,
  'photo-frame': PhotoFrameModel,
  'candle-set': CandleSetModel,
  'table-clock': TableClockModel,
  'cushion-set': CushionSetModel,
  'plush-toy': PlushToyModel,
  'whale-figurine': WhaleFigurineModel,
  'book-stack': BookStackModel,
  'desk-organizer': DeskOrganizerModel,
  'globe': GlobeModel,
  'easel': EaselModel,
  // ---- 室外 ----
  'palm-tree': PalmTreeModel,
  'fountain': FountainModel,
  'wooden-platform': WoodenPlatformModel,
  'hammock': HammockModel,
  'swing': SwingModel,
  'campfire': CampfireModel,
  'telescope': TelescopeModel,
  'birdhouse': BirdhouseModel,
  'wishing-well': WishingWellModel,
  'fence-picket': PicketFenceModel,
  // ---- 室外家具（互動） ----
  'bench-garden': GardenBenchModel,
  'lounger-wood': WoodLoungerModel,
  'lounger-beach': BeachLoungerModel,
  'hanging-chair': HangingChairModel,
  'tree-stump-seat': TreeStumpSeatModel,
  'camp-chair': CampChairModel,
  'picnic-blanket': PicnicBlanketModel,
  'picnic-basket': PicnicBasketModel,
  'picnic-table': PicnicTableModel,
  'viewing-deck': ViewingDeckModel,
  'tent': TentModel,
  'firewood-stack': FirewoodStackModel,
  'frisbee': FrisbeeModel,
  'beach-ball': BeachBallModel,
  // ---- 室外植物：樹木 ----
  'tree-broadleaf': BroadleafTreeModel,
  'tree-fruit': FruitTreeModel,
  'tree-tropical': TropicalTreeModel,
  'tree-dwarf': DwarfTreeModel,
  'tree-blossom': BlossomTreeModel,
  'tree-driftwood': DriftwoodTreeModel,
  'tree-coastal': CoastalShrubTreeModel,
  'tree-bamboo': BambooModel,
  // ---- 室外植物：灌木 ----
  'shrub-round': RoundShrubModel,
  'shrub-flowering': FloweringShrubModel,
  'shrub-tropical': TropicalShrubModel,
  'shrub-wild': WildShrubModel,
  // ---- 室外植物：花卉 ----
  'flower-cluster': FlowerClusterModel,
  'flower-single': SingleFlowerModel,
  'flower-tropical': TropicalFlowerModel,
  'flower-carpet': FlowerCarpetModel,
  // ---- 室外植物：地被 ----
  'grass-tuft': GrassTuftModel,
  'fern': FernModel,
  'leaf-plant': LeafPlantModel,
  'groundcover-wild': WildGroundcoverModel,
  // ---- 室外植物：特殊景觀 ----
  'tropical-leaf-large': LargeTropicalLeafModel,
  'mushroom-cluster': MushroomClusterModel,
  'cactus': CactusModel,
  'vine-trellis': VineTrellisModel,
  'water-lily-planter': WaterLilyPlanterModel,
  // ---- 寵物 ----
  'pet-bed': PetBedModel,
  'pet-dog-cabin': PetDogCabinModel,
  'pet-dog-tent': PetDogTentModel,
  'pet-dog-basket': PetDogBasketModel,
  'pet-cat-donut': PetCatDonutModel,
  'pet-cat-yarn': PetCatYarnModel,
  'pet-cat-tower': PetCatTowerModel,
  'pet-bird-cage': PetBirdCageModel,
  'pet-bird-perch': PetBirdPerchModel,
  'pet-bird-nest': PetBirdNestModel,
};

export function FurnitureModel({ name, item, scale: _scale = 0.85, instanceId }: { name: string, item?: any, scale?: number, instanceId?: string }) {
  const resolvedItem = item || ALL_ITEMS.find(i => i.name === name);
  const isBuilding = resolvedItem?.category === ItemCategory.BUILDING;
  // 三層縮放，一次算完：呼叫端給的世界縮放（島上 0.85 / 室內 1.15）、BUILDING 級距的加成，
  // 以及植栽自己的景觀級距倍率（constants/outdoorScale.ts）。第三層是後來補的 —— 整個樹木
  // 貨架除了椰子樹以外都比玩家矮，地被則小到在正常遊戲視角下看不見。
  //
  // 三層都在這裡相乘，而不是任何一層自己去改模型幾何，是因為碰撞體、擺放 footprint 與所有
  // audit 都是把這個 `scale` 交給同一個 `FurnitureModel` 量出來的（lib/furniturePlacement.ts、
  // scripts/lib/measureFurnitureModel.ts）。尺寸只在這一行被決定，就不會有「看起來一個大小、
  // 碰起來另一個大小」。
  const scale = (isBuilding ? _scale * 1.55 : _scale) * landscapeScaleOf(resolvedItem?.id);

  // 藝術品 first. Its ~45 pieces are generated from constants/artwork.ts by FORM rather than
  // authored one component each, so they do not carry a `model` id at all — the spec IS the
  // model reference. Same principle as the lookup below, one catalog over.
  const artwork = resolvedItem?.id ? getArtworkSpec(resolvedItem.id) : undefined;
  if (artwork) return <ArtworkModel spec={artwork} scale={scale} instanceId={instanceId} />;

  const Component = resolvedItem?.model ? FURNITURE_MODELS[resolvedItem.model as FurnitureModelId] : undefined;
  if (Component) {
    return <Component scale={scale} item={resolvedItem} instanceId={instanceId} />;
  }

  return (
    <mesh scale={scale} castShadow receiveShadow>
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color="#3b82f6" roughness={0.1} metalness={0.2} emissive="#3b82f6" emissiveIntensity={0.2} />
    </mesh>
  );
}

export function FurnitureItem({
  item,
  placement,
  isSelecting,
  onClick
}: {
  item: any,
  placement: PlacedItem,
  isSelecting?: boolean,
  onClick?: () => void
}) {
  return (
    <group
      position={placement.position}
      rotation={[0, placement.rotation || 0, 0]}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      <FurnitureModel name={item.name} item={item} />
      {isSelecting && (
        <mesh position={[0, SURFACE_DECAL_LIFT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.2, 1.3, 32]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.8} {...DECAL_DEPTH_BIAS} />
        </mesh>
      )}
    </group>
  );
}
